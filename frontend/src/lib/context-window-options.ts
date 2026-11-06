/**
 * 上下文窗口可选档位（tokens）——模型菜单刻度条与设置页模型偏好共用的单一真源。
 * 档位是 UI 选档 affordance，盘上仍只存整数 token 数。
 */
export const CONTEXT_WINDOW_OPTIONS: readonly number[] = [
  32_000, 64_000, 128_000, 200_000, 400_000, 1_000_000,
];

/**
 * 把用户已保存但不在档位表里的值（例如 256K / 1.5M）并入刻度轴，
 * 保证换成滑条后历史配置不会被静默改写。
 */
export function contextWindowScale(
  value: number | undefined | null,
  options: readonly number[] = CONTEXT_WINDOW_OPTIONS,
): number[] {
  const stops = new Set<number>(options);
  if (value && value > 0) stops.add(Math.round(value));
  return [...stops].sort((a, b) => a - b);
}
