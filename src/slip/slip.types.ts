export interface SlipOkSuccess {
  ok: true;
  transRef: string;
  amount: number;
  transDate: string;
  transTime: string;
  slipUrl: string;
}

export interface SlipOkFailure {
  ok: false;
  code: number;
  message: string;
}

export type SlipOkResult = SlipOkSuccess | SlipOkFailure;

export const SLIPOK_ERROR_MESSAGES: Record<
  number,
  { userMessage: string; escalate: boolean }
> = {
  1006: {
    userMessage: 'รูปภาพไม่ถูกต้อง กรุณาส่งสลิปใหม่อีกครั้งค่ะ',
    escalate: false,
  },
  1007: {
    userMessage:
      'ไม่พบ QR Code ในรูป กรุณาส่งสลิปที่ชัดเจนขึ้นค่ะ',
    escalate: false,
  },
  1011: {
    userMessage:
      'สลิปหมดอายุหรือไม่มีรายการจริง กรุณาติดต่อแอดมินค่ะ',
    escalate: true,
  },
  1012: {
    userMessage: 'สลิปนี้เคยตรวจแล้ว กรุณาตรวจสอบอีกครั้งค่ะ',
    escalate: false,
  },
  1013: {
    userMessage: 'ยอดเงินไม่ตรงกับออเดอร์ กรุณาตรวจสอบยอดและส่งใหม่ค่ะ',
    escalate: false,
  },
  1014: {
    userMessage: 'บัญชีผู้รับไม่ตรง กรุณาติดต่อแอดมินค่ะ',
    escalate: true,
  },
};
