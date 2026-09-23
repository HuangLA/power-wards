import { useEffect, useState } from 'react';
import { DialogManager, ExportChoice, LeaveChoice } from './controller';

type PendingDialog =
  | { kind: 'leave'; resolve: (choice: LeaveChoice) => void }
  | { kind: 'export'; resolve: (choice: ExportChoice) => void }
  | { kind: 'name'; title: string; defaultName: string; resolve: (name: string | null) => void }
  | { kind: 'confirm'; message: string; resolve: (ok: boolean) => void }
  | { kind: 'notice'; message: string; resolve: () => void };

export class ReactDialogManager implements DialogManager {
  private setter: ((dialog: PendingDialog | null) => void) | null = null;

  attach(setter: (dialog: PendingDialog | null) => void): void {
    this.setter = setter;
  }

  leaveGuard(): Promise<LeaveChoice> {
    return new Promise((resolve) => this.setter?.({ kind: 'leave', resolve }));
  }

  exportGuard(): Promise<ExportChoice> {
    return new Promise((resolve) => this.setter?.({ kind: 'export', resolve }));
  }

  promptName(title: string, defaultName: string): Promise<string | null> {
    return new Promise((resolve) => this.setter?.({ kind: 'name', title, defaultName, resolve }));
  }

  confirm(message: string): Promise<boolean> {
    return new Promise((resolve) => this.setter?.({ kind: 'confirm', message, resolve }));
  }

  notice(message: string): Promise<void> {
    return new Promise((resolve) => this.setter?.({ kind: 'notice', message, resolve }));
  }
}

export function Dialogs({ manager }: { manager: ReactDialogManager }) {
  const [pending, setPending] = useState<PendingDialog | null>(null);
  const [nameValue, setNameValue] = useState('');

  useEffect(() => {
    manager.attach(setPending);
  }, [manager]);

  useEffect(() => {
    if (pending?.kind === 'name') setNameValue(pending.defaultName);
  }, [pending]);

  if (!pending) return null;

  const close = (resolve: () => void) => {
    resolve();
    setPending(null);
  };

  return (
    <div className="dialog-backdrop" role="presentation">
      <div className="dialog" role="dialog" aria-modal="true">
        {pending.kind === 'leave' && (
          <>
            <h3>有未保存的修改</h3>
            <p>当前 Profile 存在未保存修改，离开前要保存吗？</p>
            <div className="dialog-actions">
              <button onClick={() => close(() => pending.resolve('cancel'))}>取消</button>
              <button className="danger" onClick={() => close(() => pending.resolve('discard'))}>放弃修改</button>
              <button className="primary" onClick={() => close(() => pending.resolve('save'))}>保存</button>
            </div>
          </>
        )}
        {pending.kind === 'export' && (
          <>
            <h3>导出前需要保存</h3>
            <p>存在未保存修改。导出只包含已保存内容，请先保存或另存为。</p>
            <div className="dialog-actions">
              <button onClick={() => close(() => pending.resolve('cancel'))}>取消</button>
              <button onClick={() => close(() => pending.resolve('saveAs'))}>另存为</button>
              <button className="primary" onClick={() => close(() => pending.resolve('save'))}>保存并导出</button>
            </div>
          </>
        )}
        {pending.kind === 'name' && (
          <>
            <h3>{pending.title}</h3>
            <input
              autoFocus
              value={nameValue}
              maxLength={100}
              onChange={(event) => setNameValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && nameValue.trim()) close(() => pending.resolve(nameValue.trim()));
                if (event.key === 'Escape') close(() => pending.resolve(null));
              }}
              aria-label="Profile 名称"
            />
            <div className="dialog-actions">
              <button onClick={() => close(() => pending.resolve(null))}>取消</button>
              <button className="primary" disabled={!nameValue.trim()} onClick={() => close(() => pending.resolve(nameValue.trim()))}>
                确定
              </button>
            </div>
          </>
        )}
        {pending.kind === 'confirm' && (
          <>
            <h3>确认操作</h3>
            <p>{pending.message}</p>
            <div className="dialog-actions">
              <button onClick={() => close(() => pending.resolve(false))}>取消</button>
              <button className="danger" onClick={() => close(() => pending.resolve(true))}>确定</button>
            </div>
          </>
        )}
        {pending.kind === 'notice' && (
          <>
            <h3>提示</h3>
            <p>{pending.message}</p>
            <div className="dialog-actions">
              <button className="primary" autoFocus onClick={() => close(() => pending.resolve())}>知道了</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
