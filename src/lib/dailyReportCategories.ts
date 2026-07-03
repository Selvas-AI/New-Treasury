/** 자금일보 입금/출금 카테고리 정의 — ItemsSection과 CashflowForecastTab(주간예측)이 공유 */

export interface CategoryDef {
  code:      string
  label:     string
  linked?:   boolean
  thread?:   boolean
}

export const IN_CATEGORIES: CategoryDef[] = [
  { code: 'ar_collection',   label: '매출채권 회수'   },
  { code: 'other_receivable',label: '미수금 회수'     },
  { code: 'govt_fund',       label: '국책자금 회수'   },
  { code: 'advance_in',      label: '선수금 입금'     },
  { code: 'invest_return',   label: '투자금 회수',    linked: true  },
  { code: 'loan_drawdown',   label: '차입금 실행',    linked: true  },
  { code: 'interest_income', label: '이자수익'        },
  { code: 'invest_eval_in',  label: '투자자산평가'    },
  { code: 'other_in',        label: '기타',           thread: true  },
]

export const OUT_CATEGORIES: CategoryDef[] = [
  { code: 'ap_payment',      label: '미지급금 지급'  },
  { code: 'trade_ap_payment',label: '외상매입금 지급' },
  { code: 'advance_out',     label: '선급금 지급'    },
  { code: 'invest_execute',  label: '투자 집행',     linked: true  },
  { code: 'loan_repayment',  label: '차입금 상환',   linked: true  },
  { code: 'interest_expense',label: '이자비용'       },
  { code: 'enote_payment',   label: '전자어음결제'   },
  { code: 'invest_eval_out', label: '투자자산평가'   },
  { code: 'other_out',       label: '기타',          thread: true  },
]
