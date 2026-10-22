import { Icon } from '@/components/icons/Icon';

/**
 * FullAccessConfirmDialog — 完全访问档位确认层（BLOCK-244 Q1-REM D3）。
 *
 * 高危档位显式确认：能力清单 + 风险提示 + 可随时切回；本会话确认一次，
 * 取消不改变当前档位。纯展示组件，状态由 SimpleChat 持有。
 */
export interface FullAccessConfirmDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const CAPABILITIES = [
  '执行本地命令行（含项目外路径与安装依赖）',
  '修改项目文件、运行后台进程',
  '调用插件执行与外部 MCP 工具',
  '读取/写入受完全访问保护的系统能力',
];

export function FullAccessConfirmDialog({ open, onConfirm, onCancel }: FullAccessConfirmDialogProps): React.ReactElement | null {
  if (!open) return null;
  return (
    <div className="sc-full-access-overlay" data-testid="full-access-confirm">
      <div className="sc-full-access-dialog" role="alertdialog" aria-label="完全访问确认">
        <div className="sc-full-access-dialog__head">
          <span className="sc-full-access-dialog__icon" aria-hidden="true"><Icon name="shield" size={16} /></span>
          <strong>开启完全访问？</strong>
        </div>
        <p className="sc-full-access-dialog__intro">
          完全访问允许 Agent 在你的机器上执行高权限操作。请只在可信项目中开启，并确认你理解以下能力与风险。
        </p>
        <ul className="sc-full-access-dialog__list">
          {CAPABILITIES.map((item) => <li key={item}>{item}</li>)}
        </ul>
        <p className="sc-full-access-dialog__risk" data-testid="full-access-risk">
          风险：命令可能在项目外产生不可逆修改；后台进程会持续占用资源。你可以随时在档位菜单切回「项目写」或「只读」。
        </p>
        <div className="sc-full-access-dialog__actions">
          <button
            type="button"
            className="sc-full-access-dialog__btn sc-full-access-dialog__btn-primary"
            data-testid="full-access-confirm-yes"
            onClick={onConfirm}
          >
            确认开启完全访问
          </button>
          <button
            type="button"
            className="sc-full-access-dialog__btn"
            data-testid="full-access-confirm-no"
            onClick={onCancel}
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
