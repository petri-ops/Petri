// ============================================================
// useComposerContext.ts — BLOCK-245 P2「上下文装配单列表」状态簇
//
// 收敛前：选中文段与图片引用各自持 useState + useRef 镜像 + 事件订阅 +
// remove 回调（SimpleChat.tsx 原 340-374 行），组装知识散在三处调用点。
// 收敛后：一条 ComposerContextItem 列表 + contextItems.ts 的唯一渲染入口。
//
// 行为守恒要点（有意保留的现状不对称，见 composeSelectionsOnly 注释）：
// 排队/插队路径只携带选中文段引用，图片引用留在 composer 里随下一次发送走。
// ============================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { petriEvents, subscribePetriEvent } from '@/lib/events';
import { makeImageReference, type ImageReference } from '../imageReferences';
import { makeSelectionReference, type SelectionReference } from '../selectionReferences';
import type { UploadedAttachmentRef } from '../attachmentUpload';
import {
  CONTEXT_GROUP_CAPS,
  appendContextItem,
  attachmentContextItems,
  composeContextMessage,
  imageContextItem,
  removeContextItem,
  selectionContextItem,
  type ComposerContextItem,
} from '../contextItems';
import { contextDedupedNotice, contextLimitNotice } from '../contextLimits';
import type { ImageQuoteDetail, SelectionQuoteDetail } from '@/lib/events';

// 成员一律写成属性（函数类型）而非方法签名：调用点会把它们从对象上解构下来
// 传参（useChatStream getter / JSX 回调），方法签名会触发 unbound-method 误用面。
export interface ComposerContextApi {
  items: ComposerContextItem[];
  /** chip 渲染用的结构化载荷（按组拆分，顺序=加入序）。 */
  selections: SelectionReference[];
  images: ImageReference[];
  /** 其余七类候选（文件/技能/连接器/智能体/结果/知识空间/会话）的条目本身。 */
  others: ComposerContextItem[];
  imageCount: number;
  /** 引用块（图片 + 选中文段）+ 用户文本 + 附件尾追——发送面的唯一组装入口。 */
  composeForSend: (text: string, attachments?: UploadedAttachmentRef[]) => string;
  /**
   * 排队/插队面的组装入口：现状只叠选中文段（图片引用不入队，仍留在 composer
   * 里等下一次真实发送）。收敛不得静默改变这条语义——它被登记为后续待裁决项。
   */
  composeSelectionsOnly: (text: string) => string;
  /** 非响应式读取（useChatStream 的 hasImages getter 用，避免每轮新依赖）。 */
  hasImageItems: () => boolean;
  /** 追加一条候选（`@` 菜单选中面；上限/去重/信号全部走 contextItems 单源）。 */
  addItem: (item: ComposerContextItem) => void;
  /** 上限/去重的人话提示（P5 诚实化：不再是静默丢弃）；null = 无异常。 */
  notice: string | null;
  removeItem: (id: string) => void;
  clearSelections: () => void;
  clearAll: () => void;
}

export interface UseComposerContextOptions {
  projectId: string;
  /** 仅 copilotAsk 拥有者（中央会话）消费引用事件，避免右栏 chat tab 重复入列。 */
  ownsEventBus: boolean;
}

export function useComposerContext(options: UseComposerContextOptions): ComposerContextApi {
  const { projectId, ownsEventBus } = options;
  const [items, setItems] = useState<ComposerContextItem[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const itemsRef = useRef<ComposerContextItem[]>([]);
  // 单一写入口：state 与镜像同时前进（P5 的 replace 语义不能靠 effect 追平）。
  const commit = useCallback((next: ComposerContextItem[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);

  const addItem = useCallback((item: ComposerContextItem) => {
    const result = appendContextItem(itemsRef.current, item);
    commit(result.items);
    // P5 — 上限/去重由信号转人话（文案单源 = contextLimits），不再静默。
    if (result.dropped > 0) {
      setNotice(contextLimitNotice(item.group, CONTEXT_GROUP_CAPS[item.group] ?? 0, result.dropped));
    } else if (result.deduped) {
      setNotice(contextDedupedNotice(item.group));
    } else {
      setNotice(null);
    }
  }, [commit]);

  const addSelection = useCallback((detail: SelectionQuoteDetail) => {
    if (detail.projectId && detail.projectId !== projectId) return;
    const ref = makeSelectionReference(detail);
    if (ref) addItem(selectionContextItem(ref));
  }, [addItem, projectId]);

  const addImage = useCallback((detail: ImageQuoteDetail) => {
    if (detail.projectId && detail.projectId !== projectId) return;
    const ref = makeImageReference(detail);
    if (ref) addItem(imageContextItem(ref));
  }, [addItem, projectId]);

  // 右栏「引用到对话」/图片引用事件（BLOCK-52 P1/P2 的订阅面，原样收进本簇）。
  useEffect(() => {
    if (!ownsEventBus) return undefined;
    const offSelection = subscribePetriEvent(petriEvents.selectionQuote, addSelection);
    const offImage = subscribePetriEvent(petriEvents.imageQuote, addImage);
    return () => {
      offSelection();
      offImage();
    };
  }, [ownsEventBus, addSelection, addImage]);

  const composeForSend = useCallback((text: string, attachments: UploadedAttachmentRef[] = []) => (
    composeContextMessage(text, [...itemsRef.current, ...attachmentContextItems(attachments)])
  ), []);

  const composeSelectionsOnly = useCallback((text: string) => composeContextMessage(
    text,
    itemsRef.current.filter((entry) => entry.group === 'reference'),
  ), []);

  const hasImageItems = useCallback(() => itemsRef.current.some((entry) => entry.group === 'image'), []);

  const removeItem = useCallback((id: string) => {
    commit(removeContextItem(itemsRef.current, id));
  }, [commit]);

  const clearSelections = useCallback(() => {
    commit(itemsRef.current.filter((entry) => entry.group !== 'reference'));
  }, [commit]);

  const clearAll = useCallback(() => commit([]), [commit]);

  const selections = useMemo(
    () => items.filter((entry) => entry.kind === 'selection').map((entry) => entry.payload as SelectionReference),
    [items],
  );
  const images = useMemo(
    () => items.filter((entry) => entry.kind === 'image').map((entry) => entry.payload as ImageReference),
    [items],
  );
  // 单列表里除选中文段/图片外的其余条目（`@` 菜单产出的七类）——UI 必须可见可移除，
  // 否则"引用"只在正文里存在、用户看不见（诚实性缺口）。
  const others = useMemo(
    () => items.filter((entry) => entry.group === 'reference' && entry.kind !== 'selection'),
    [items],
  );

  return {
    items,
    selections,
    images,
    others,
    imageCount: images.length,
    composeForSend,
    composeSelectionsOnly,
    hasImageItems,
    addItem,
    notice,
    removeItem,
    clearSelections,
    clearAll,
  };
}
