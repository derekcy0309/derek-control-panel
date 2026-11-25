// Never put an owner, task ID, bot credential, or external resource in this URL.
export const briefStartUrl = "https://derek-control-panel.vercel.app/#dayline-start";

export function briefStartFooter(title?: string | null) {
  const label = title?.trim();
  // A task name can itself be a copied link, multiline note or Markdown. Do not
  // turn that into another link/instruction in a compact plain-text report.
  const safe = label && label.length <= 160 && !/[\p{C}\p{Zl}\p{Zp}<>\[\]`]/u.test(label)
    && !/(?:[a-z][\w+.-]*:\/\/|www\.|@|\b(?:mailto|tel|data|javascript):|[\w-]+\.[a-z]{2,}(?:\/|\b))/i.test(label);
  return (safe ? `今日首項工作：${label}｜` : "") + "登入日序開始工作：" + briefStartUrl;
}
