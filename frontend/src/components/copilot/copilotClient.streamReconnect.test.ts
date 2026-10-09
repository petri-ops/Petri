/**
 * BLOCK-39 — Agent 事件流断线重连测试（copilotClient.subscribeAgentTask）
 *
 * 覆盖：流截断（未见 [DONE]）→ afterSeq 续传重连 → 收到 failed+resumable 终态
 * （免刷新自动亮「继续执行」的核心判据）；fetch 网络拒绝退避重连；重试耗尽
 * 如实上抛；HTTP 4xx 不重试；用户停止（abort）不重试且不触发 onError。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentStreamDisconnectedError, subscribeAgentTask } from './copilotClient';
import type { StreamChatOptions } from './copilotClient';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const encoder = new TextEncoder();

/** 构造 SSE fetch 响应桩：按 chunks 依次返回，读尽即正常关流（done=true） */
function sseResponse(chunks: string[]): Response {
  let i = 0;
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: async () => {
          if (i < chunks.length) {
            return { done: false, value: encoder.encode(chunks[i++]) };
          }
          return { done: true, value: undefined };
        },
      }),
    },
    text: async () => '',
  } as unknown as Response;
}

/** 构造读流中途抛错的响应（模拟连接被切断） */
function brokenStreamResponse(chunks: string[]): Response {
  let i = 0;
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: async () => {
          if (i < chunks.length) {
            return { done: false, value: encoder.encode(chunks[i++]) };
          }
          throw new TypeError('network error: connection reset');
        },
      }),
    },
    text: async () => '',
  } as unknown as Response;
}

function makeOpts(overrides: Partial<StreamChatOptions> = {}): StreamChatOptions {
  return {
    messages: [],
    onDelta: vi.fn(),
    onDone: vi.fn(),
    onError: vi.fn(),
    onStreamReconnecting: vi.fn(),
    ...overrides,
  };
}

describe('BLOCK-39 agent 事件流断线重连', () => {
  it('message_persist_failed 事件分发到 onMessagePersistFailed（BLOCK-150 ③ 前端消费接线）', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValueOnce(
      sseResponse([
        'data: {"seq":1,"eventType":"delta","payload":{"delta":"部分回答"}}\n\n',
        'data: {"event":"message_persist_failed","conversationId":"conv-1","role":"assistant"}\n\n',
        'data: {"event":"done"}\n\n',
        'data: [DONE]\n\n',
      ])
    );
    vi.stubGlobal('fetch', fetchMock);

    const onMessagePersistFailed = vi.fn();
    const opts = makeOpts({ onMessagePersistFailed });
    const promise = subscribeAgentTask('t-persist', opts, 0);
    await vi.runAllTimersAsync();
    await promise;

    expect(onMessagePersistFailed).toHaveBeenCalledTimes(1);
    expect(onMessagePersistFailed).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1', role: 'assistant' }),
    );
  });

  it('流截断后以 afterSeq=lastSeq 重连，收到 failed+resumable 终态（免刷新亮按钮核心判据）', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        // 首次订阅：回放 1 条事件（seq=1）后干净截断，未见 [DONE]
        sseResponse(['data: {"seq":1,"eventType":"agent_status","payload":{"event":"agent_status","phase":"iter","message":"第 1 轮"}}\n\n'])
      )
      .mockResolvedValueOnce(
        // 重连后：后端已清扫 → failed 终态事件（BLOCK-38 resumable 标记）+ [DONE]
        sseResponse([
          'data: {"event":"error","error":"服务重启，Agent 任务中断","resumable":true,"interruptedAt":"2026-09-02T10:00:00.000Z"}\n\n',
          'data: [DONE]\n\n',
        ])
      );
    vi.stubGlobal('fetch', fetchMock);

    const opts = makeOpts();
    const promise = subscribeAgentTask('t-interrupted', opts, 0);
    await vi.runAllTimersAsync();
    await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain('afterSeq=1');
    expect(opts.onStreamReconnecting).toHaveBeenCalledWith({
      taskId: 't-interrupted',
      attempt: 1,
      lastSeq: 1,
      nextRetryMs: 1000,
    });
    expect(opts.onError).toHaveBeenCalledTimes(1);
    const [err, info] = (opts.onError as ReturnType<typeof vi.fn>).mock.calls[0] as [Error, { resumable: boolean; interruptedAt: string }];
    expect(String(err.message)).toContain('服务重启，Agent 任务中断');
    expect(info).toMatchObject({ resumable: true, interruptedAt: '2026-09-02T10:00:00.000Z' });
    // 终态 [DONE] 后 onDone 仍触发（store 侧 finish 守卫保证 error 不被覆盖）
    expect(opts.onDone).toHaveBeenCalledTimes(1);
  });

  it('读流中途断开保留 lastSeq，退避重连至正常完成', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        brokenStreamResponse([
          'data: {"seq":1,"eventType":"delta","payload":{"delta":"a"}}\n\n',
          'data: {"seq":2,"eventType":"delta","payload":{"delta":"b"}}\n\n',
        ])
      )
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(sseResponse(['data: [DONE]\n\n']));
    vi.stubGlobal('fetch', fetchMock);

    const opts = makeOpts();
    const promise = subscribeAgentTask('t-network', opts, 0);
    await vi.runAllTimersAsync();
    await promise;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[1][0])).toContain('afterSeq=2');
    expect(String(fetchMock.mock.calls[2][0])).toContain('afterSeq=2');
    const reconnectCalls = (opts.onStreamReconnecting as ReturnType<typeof vi.fn>).mock.calls as Array<[{ attempt: number; nextRetryMs: number }]>;
    expect(reconnectCalls.map((c) => c[0].attempt)).toEqual([1, 2]);
    expect(reconnectCalls.map((c) => c[0].nextRetryMs)).toEqual([1000, 2000]);
    expect(opts.onDone).toHaveBeenCalledTimes(1);
    expect(opts.onError).not.toHaveBeenCalled();
  });

  it('重试耗尽后如实上抛 AgentStreamDisconnectedError（不假完成）', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    const opts = makeOpts();
    const promise = subscribeAgentTask('t-down', opts, 0);
    const expectation = expect(promise).rejects.toBeInstanceOf(AgentStreamDisconnectedError);
    await vi.runAllTimersAsync();
    await expectation;

    // 初始 1 次 + 有界重连 24 次
    expect(fetchMock).toHaveBeenCalledTimes(25);
    expect(opts.onDone).not.toHaveBeenCalled();
  });

  it('干净截断且重试耗尽时不误调 onDone（消除假完成）', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    const opts = makeOpts();
    const promise = subscribeAgentTask('t-truncated', opts, 0);
    const expectation = expect(promise).rejects.toBeInstanceOf(AgentStreamDisconnectedError);
    await vi.runAllTimersAsync();
    await expectation;

    expect(opts.onDone).not.toHaveBeenCalled();
  });

  it('HTTP 4xx 不重试，如实上抛', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => '{"error":"task 不存在"}',
    });
    vi.stubGlobal('fetch', fetchMock);

    const opts = makeOpts();
    await expect(subscribeAgentTask('t-404', opts, 0)).rejects.toThrow('HTTP 404');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(opts.onStreamReconnecting).not.toHaveBeenCalled();
    expect(opts.onDone).not.toHaveBeenCalled();
  });

  it('用户停止（abort）在重连等待期生效，不触发 onError、不再重试', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sseResponse(['data: {"seq":1,"eventType":"delta","payload":{"delta":"a"}}\n\n']));
    vi.stubGlobal('fetch', fetchMock);

    const opts = makeOpts({ signal: controller.signal });
    const promise = subscribeAgentTask('t-abort', opts, 0);
    const expectation = expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    // 截断后进入重连等待期 → 用户停止
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await expectation;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(opts.onError).not.toHaveBeenCalled();
    expect(opts.onDone).not.toHaveBeenCalled();
  });

  it('回归：后端发带引号 "[DONE]"（JSON.stringify 历史 bug 形状）也能正常收口，不重连不报错', async () => {
    // 实机缺陷复现形状：events.js 曾用 sseSend('[DONE]') → 序列化为 data: "[DONE]"
    // → 前端匹配裸 [DONE] 失败 → 正常完成的 task 被判断线 → 90s 重连烧窗后报错
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        sseResponse([
          'data: {"seq":1,"eventType":"delta","payload":{"delta":"回复完成"}}\n\n',
          'data: {"event":"done","filesChanged":[]}\n\n',
          'data: "[DONE]"\n\n',
        ])
      );
    vi.stubGlobal('fetch', fetchMock);

    const opts = makeOpts();
    await subscribeAgentTask('t-quoted-done', opts, 0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(opts.onDone).toHaveBeenCalledTimes(1);
    expect(opts.onError).not.toHaveBeenCalled();
    expect(opts.onStreamReconnecting).not.toHaveBeenCalled();
  });
});
