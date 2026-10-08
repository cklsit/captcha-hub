// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TotpCard } from '../src/components/TotpCard';
import type { TotpDisplay } from '../shared/types';

/**
 * Renderer-level guard for a visual bug the user hit: the countdown ring and
 * the edit/delete buttons were drawn on top of each other, and the ring itself
 * rendered as a broken arc.
 *
 * Asserting on the rendered DOM (rather than grepping source for strings) is
 * the only way these claims can actually be checked, which is why the project
 * gained a jsdom environment for this file.
 */

const DATA: TotpDisplay = {
  id: 'totp-1',
  name: 'GitHub',
  issuer: 'GitHub',
  account: 'cklsit',
  code: '645100',
  remaining: 21,
  period: 30,
  progress: 0.7,
  enabled: true,
};

// Testing Library only auto-registers this when Vitest globals are on, and this
// project keeps them off. Without it every test would render into the same
// document and the queries below would find duplicates.
afterEach(cleanup);

describe('TotpCard 的倒计时环', () => {
  it('由「静态底圈 + 进度弧」两段组成，不再是一段断掉的半圆', () => {
    const { container } = render(<TotpCard data={DATA} onCopy={() => undefined} />);
    // A lone determinate CircularProgress paints only the arc; the stacked
    // value-100 ring is what turns it back into a readable countdown.
    expect(container.querySelectorAll('.MuiCircularProgress-root')).toHaveLength(2);
  });

  it('时间所剩无几时切成告警色', () => {
    const { container } = render(
      <TotpCard data={{ ...DATA, remaining: 3, progress: 0.1 }} onCopy={() => undefined} />,
    );
    expect(container.querySelector('.MuiCircularProgress-colorError')).not.toBeNull();
  });

  it('时间充裕时用主色', () => {
    const { container } = render(<TotpCard data={DATA} onCopy={() => undefined} />);
    expect(container.querySelector('.MuiCircularProgress-colorPrimary')).not.toBeNull();
  });
});

describe('TotpCard 的操作按钮布局（回归重点）', () => {
  it('编辑/删除按钮不在倒计时环的容器内 —— 这正是重叠的成因', () => {
    const { container } = render(
      <TotpCard data={DATA} onCopy={() => undefined} onEdit={() => undefined} onDelete={() => undefined} />,
    );

    const ringBox = container.querySelector('.MuiCircularProgress-root')?.parentElement ?? null;
    const edit = screen.getByLabelText('编辑验证器');
    const remove = screen.getByLabelText('删除验证器');

    expect(ringBox).not.toBeNull();
    expect(ringBox?.contains(edit)).toBe(false);
    expect(ringBox?.contains(remove)).toBe(false);
  });

  it('两个按钮渲染在卡片正文内部，而不是浮在卡片上的独立层', () => {
    const { container } = render(
      <TotpCard data={DATA} onCopy={() => undefined} onEdit={() => undefined} onDelete={() => undefined} />,
    );
    const content = container.querySelector('.MuiCardContent-root');
    expect(content).not.toBeNull();
    expect(content?.contains(screen.getByLabelText('编辑验证器'))).toBe(true);
    expect(content?.contains(screen.getByLabelText('删除验证器'))).toBe(true);
  });

  it('未提供回调时不渲染多余按钮', () => {
    render(<TotpCard data={DATA} onCopy={() => undefined} />);
    expect(screen.queryByLabelText('编辑验证器')).toBeNull();
    expect(screen.queryByLabelText('删除验证器')).toBeNull();
  });
});

describe('TotpCard 的交互', () => {
  it('点击编辑/删除分别触发对应回调', () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(
      <TotpCard data={DATA} onCopy={() => undefined} onEdit={onEdit} onDelete={onDelete} />,
    );

    fireEvent.click(screen.getByLabelText('编辑验证器'));
    fireEvent.click(screen.getByLabelText('删除验证器'));

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('复制按钮把当前验证码交出去', () => {
    const onCopy = vi.fn();
    render(<TotpCard data={DATA} onCopy={onCopy} />);
    fireEvent.click(screen.getByLabelText('复制验证码'));
    expect(onCopy).toHaveBeenCalledWith('645100');
  });

  it('展示发行方、账户与剩余时间', () => {
    render(<TotpCard data={DATA} onCopy={() => undefined} />);
    expect(screen.getByText('GitHub')).toBeTruthy();
    expect(screen.getByText('cklsit')).toBeTruthy();
    expect(screen.getByText('645100')).toBeTruthy();
    expect(screen.getByText(/21 秒后刷新/)).toBeTruthy();
  });
});
