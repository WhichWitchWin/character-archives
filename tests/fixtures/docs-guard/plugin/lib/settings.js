// 测试用的最小设置表：只有 recall.budgetChars 一项，
// 这样 DESIGN 里写 `recall.ghost` 就能验证「设置键不存在」这条规则。
export const DEFAULT_SETTINGS = Object.freeze({
  recall: Object.freeze({
    budgetChars: 3000,
  }),
})
