/** Dòng nhỏ dưới nhãn trạng thái của lời mời đang chờ: đã gửi email hay phải giao bằng link. */
export default function DeliveryNote({ status, deliveryMethod }: { status: string; deliveryMethod?: string }) {
  if (status !== 'PENDING') return null
  return deliveryMethod === 'LINK'
    ? <span data-testid="delivery-link" className="mt-1 block text-[11px] font-semibold text-amber-700">Chưa gửi mail, lấy link mời</span>
    : <span data-testid="delivery-email" className="mt-1 block text-[11px] text-[#737686]">Đã gửi email</span>
}
