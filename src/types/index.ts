export type UserRole = 'master' | 'ceo' | 'company'

export interface TreasuryUser {
  role: UserRole
  company: string | null
  label: string
  code: string
  sb_id: string
}

export type Company = '셀바스에이아이' | '셀바스헬스케어' | '메디아나' | 'TOTAL'
