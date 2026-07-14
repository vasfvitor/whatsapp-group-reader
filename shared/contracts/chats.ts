export type ChatType = 'group' | 'contact'

export interface ChatSummary {
  id: string
  name: string
  type: ChatType
  phoneNumber: string | null
  isSavedContact: boolean
  isBusiness: boolean
  tags: string[]
  selected: boolean
}
