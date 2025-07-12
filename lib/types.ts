export interface OptionData {
  option: string
  type: "C" | "P"
  strike: number
  expiration: Date
  gamma: number
  open_interest: number
  volume?: number // Add volume field for actual trading volume
  iv: number
  delta: number
  bid?: number // Bid price
  ask?: number // Ask price
  last?: number // Last traded price
  GEX?: number
  GEX_BS?: number
  daysTillExp?: number
}

export interface CBOEResponse {
  data: {
    current_price: number
    options: OptionData[]
  }
}

export interface GEXByStrike {
  strike: number
  gex: number
}

export interface GEXByExpiration {
  expiration: string
  gex: number
}

export interface CallPutWalls {
  callOI: { strike: number; oi: number }[]
  putOI: { strike: number; oi: number }[]
  callWall?: number
  putWall?: number
}

export interface ExpectedMove {
  date: Date
  upper: number
  lower: number
  upperPct: number
  lowerPct: number
}
