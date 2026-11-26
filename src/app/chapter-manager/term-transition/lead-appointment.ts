import type { ApiResponse } from '@/lib/api/client';
import { DEPARTMENT_LEAD_APPOINT_CONFIRM_CODE } from '@/lib/department-lead-appointment';

/**
 * Gửi yêu cầu đổi ban / bổ nhiệm. Server trả 409 DepartmentLeadReplaceConfirmRequired khi ban đã có Trưởng ban khác:
 * hỏi xác nhận bằng đúng câu cảnh báo của server, đồng ý thì gửi lại với `confirmReplace: true`.
 * Trả null nếu người dùng không đồng ý (không có gì thay đổi).
 */
export async function sendWithLeadReplaceConfirm(
  send: (extra?: Record<string, unknown>) => Promise<ApiResponse>,
  ask: (message: string) => boolean,
): Promise<ApiResponse | null> {
  const first = await send();
  if (first.ok || first.error?.code !== DEPARTMENT_LEAD_APPOINT_CONFIRM_CODE) return first;
  if (!ask(`${first.error.message}\n\nBạn vẫn muốn bổ nhiệm Trưởng ban mới?`)) return null;
  return send({ confirmReplace: true });
}

type RosterMember = { userId: string; displayName: string; isLead?: boolean };

/** Trưởng ban đứng đầu, còn lại theo tên (tiếng Việt). */
export function sortRosterMembers<T extends RosterMember>(members: T[]): T[] {
  return [...members].sort((a, b) => {
    if (a.isLead && !b.isLead) return -1;
    if (!a.isLead && b.isLead) return 1;
    return (a.displayName || '').localeCompare(b.displayName || '', 'vi');
  });
}

/**
 * Cập nhật lạc quan sau khi bổ nhiệm `userId` làm Trưởng ban: đúng 1 người mang nhãn LT,
 * Trưởng ban cũ vẫn ở lại trong ban với vai thành viên (không biến mất).
 */
export function appointLeadInMembers<T extends RosterMember>(members: T[], userId: string): T[] {
  return sortRosterMembers(members.map((m) => ({ ...m, isLead: m.userId === userId })));
}

/** Ban đang có Trưởng ban khác người này không (theo danh sách đang hiển thị). */
export function hasOtherLead(members: RosterMember[], userId: string): boolean {
  return members.some((m) => m.isLead && m.userId !== userId);
}
