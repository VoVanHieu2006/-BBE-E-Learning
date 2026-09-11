'use client';
import { useState, useEffect } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';

export interface LessonCommentItem {
  id: string;
  lessonId: string;
  userId: string;
  userEmail: string;
  userRole: 'ADMIN' | 'CHAPTER_LEADER' | 'MEMBER';
  content: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  replies?: LessonCommentItem[];
}

interface LessonCommentsProps {
  lessonId: string;
  currentUser: {
    id?: string;
    userId?: string;
    email?: string;
    role?: 'ADMIN' | 'CHAPTER_LEADER' | 'MEMBER';
  } | null;
  accessToken: string;
  onToast?: (type: 'success' | 'error' | 'info', message: string, title?: string) => void;
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffSec < 45) return 'vừa xong';
  if (diffSec < 3600) {
    const mins = Math.max(1, Math.floor(diffSec / 60));
    return `${mins} phút trước`;
  }
  if (diffSec < 86400) {
    const hours = Math.floor(diffSec / 3600);
    return `${hours} giờ trước`;
  }
  if (diffSec < 86400 * 7) {
    const days = Math.floor(diffSec / 86400);
    return `${days} ngày trước`;
  }

  return date.toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function getInitials(email: string): string {
  if (!email) return 'U';
  const name = email.split('@')[0];
  return name.slice(0, 2).toUpperCase();
}

function getAvatarBg(email: string): string {
  const colors = [
    'from-blue-500 to-indigo-600',
    'from-emerald-500 to-teal-600',
    'from-orange-500 to-amber-600',
    'from-purple-500 to-pink-600',
    'from-cyan-500 to-blue-600',
  ];
  let hash = 0;
  for (let i = 0; i < (email || '').length; i++) {
    hash = (hash + email.charCodeAt(i)) % colors.length;
  }
  return colors[hash];
}

export default function LessonComments({
  lessonId,
  currentUser,
  accessToken,
  onToast,
}: LessonCommentsProps) {
  const [comments, setComments] = useState<LessonCommentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [rootInput, setRootInput] = useState('');
  const [submittingRoot, setSubmittingRoot] = useState(false);

  // Replying state
  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const [replyInput, setReplyInput] = useState('');
  const [submittingReply, setSubmittingReply] = useState(false);

  // Deleting state
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const currentUserId = currentUser?.id || currentUser?.userId;
  const isLeaderOrAdmin =
    currentUser?.role === 'ADMIN' || currentUser?.role === 'CHAPTER_LEADER';

  useEffect(() => {
    loadComments();
    setReplyingToId(null);
    setReplyInput('');
    setRootInput('');
  }, [lessonId]);

  async function loadComments() {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/lessons/${lessonId}/comments`, {
        cache: 'no-store',
      });
      const data = await res.json();
      if (res.ok && data.comments) {
        setComments(data.comments);
      } else {
        setComments([]);
      }
    } catch (e) {
      console.error('Failed to load comments:', e);
    } finally {
      setLoading(false);
    }
  }

  async function handleSendRootComment(e: React.FormEvent) {
    e.preventDefault();
    if (!rootInput.trim() || submittingRoot) return;

    if (!accessToken) {
      onToast?.('error', 'Vui lòng đăng nhập để đặt câu hỏi.', 'Yêu cầu đăng nhập');
      return;
    }

    setSubmittingRoot(true);
    try {
      const res = await fetch(`/api/v1/lessons/${lessonId}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ content: rootInput.trim() }),
      });

      const data = await res.json();
      if (res.ok && data.comment) {
        setComments((prev) => [data.comment, ...prev]);
        setRootInput('');
        onToast?.('success', 'Đã đăng câu hỏi của bạn!', 'Thành công');
      } else {
        onToast?.(
          'error',
          data?.error?.message || 'Không thể gửi câu hỏi, vui lòng thử lại.',
          'Lỗi'
        );
      }
    } catch (err: any) {
      onToast?.('error', err?.message || 'Đã có lỗi xảy ra.', 'Lỗi');
    } finally {
      setSubmittingRoot(false);
    }
  }

  async function handleSendReply(parentId: string, e: React.FormEvent) {
    e.preventDefault();
    if (!replyInput.trim() || submittingReply) return;

    if (!accessToken) {
      onToast?.('error', 'Vui lòng đăng nhập để trả lời.', 'Yêu cầu đăng nhập');
      return;
    }

    setSubmittingReply(true);
    try {
      const res = await fetch(`/api/v1/lessons/${lessonId}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          content: replyInput.trim(),
          parentId,
        }),
      });

      const data = await res.json();
      if (res.ok && data.comment) {
        setComments((prev) =>
          prev.map((c) => {
            if (c.id === parentId) {
              return {
                ...c,
                replies: [...(c.replies || []), data.comment],
              };
            }
            return c;
          })
        );
        setReplyInput('');
        setReplyingToId(null);
        onToast?.('success', 'Đã gửi phản hồi của bạn!', 'Thành công');
      } else {
        onToast?.(
          'error',
          data?.error?.message || 'Không thể gửi phản hồi, vui lòng thử lại.',
          'Lỗi'
        );
      }
    } catch (err: any) {
      onToast?.('error', err?.message || 'Đã có lỗi xảy ra.', 'Lỗi');
    } finally {
      setSubmittingReply(false);
    }
  }

  async function handleDeleteComment(commentId: string, parentId?: string | null) {
    if (!confirm('Bạn có chắc chắn muốn xóa bình luận này?')) return;

    setDeletingId(commentId);
    try {
      const res = await fetch(`/api/v1/lessons/${lessonId}/comments/${commentId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const data = await res.json();
      if (res.ok) {
        if (parentId) {
          // It's a reply
          setComments((prev) =>
            prev.map((c) => {
              if (c.id === parentId) {
                return {
                  ...c,
                  replies: (c.replies || []).filter((r) => r.id !== commentId),
                };
              }
              return c;
            })
          );
        } else {
          // It's a root comment
          setComments((prev) => prev.filter((c) => c.id !== commentId));
        }
        onToast?.('success', 'Đã xóa bình luận thành công.', 'Thông báo');
      } else {
        onToast?.('error', data?.error?.message || 'Không thể xóa bình luận.', 'Lỗi');
      }
    } catch (err: any) {
      onToast?.('error', err?.message || 'Đã có lỗi xảy ra khi xóa.', 'Lỗi');
    } finally {
      setDeletingId(null);
    }
  }

  const renderRoleBadge = (role: string) => {
    if (role === 'ADMIN') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200">
          👑 Quản trị viên
        </span>
      );
    }
    if (role === 'CHAPTER_LEADER') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
          ⭐ Ban điều hành
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-600">
        Học viên
      </span>
    );
  };

  return (
    <Card className="p-6 border border-[#eff4ff] shadow-sm space-y-6">
      {/* Header section */}
      <div className="flex items-center justify-between pb-4 border-b border-[#eff4ff]">
        <div>
          <h3
            className="text-base font-bold text-[#172554] flex items-center gap-2"
            style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}
          >
            <span>💬</span> Hỏi đáp & Thảo luận ({comments.reduce((acc, c) => acc + 1 + (c.replies?.length || 0), 0)})
          </h3>
          <p className="text-xs text-[#737686] mt-0.5">
            Đặt câu hỏi hoặc trao đổi cùng giảng viên và các bạn học viên khác.
          </p>
        </div>
      </div>

      {/* Root Comment Input Box */}
      {accessToken ? (
        <form onSubmit={handleSendRootComment} className="space-y-3">
          <div className="flex items-start gap-3">
            <div
              className={`w-9 h-9 rounded-full bg-gradient-to-br ${getAvatarBg(
                currentUser?.email || ''
              )} text-white flex items-center justify-center text-xs font-bold shrink-0 shadow-xs`}
            >
              {getInitials(currentUser?.email || '')}
            </div>
            <div className="flex-1 min-w-0">
              <textarea
                value={rootInput}
                onChange={(e) => setRootInput(e.target.value)}
                placeholder="Bạn có thắc mắc gì về bài học này? Hãy đặt câu hỏi tại đây..."
                rows={3}
                className="w-full px-4 py-3 bg-[#f8f9ff] border border-[#cbdbf5] focus:border-[#2563EB] focus:bg-white focus:outline-none rounded-2xl text-xs text-[#172554] placeholder-[#737686] transition resize-none leading-relaxed"
              />
              <div className="flex items-center justify-between mt-2">
                <span className="text-[11px] text-[#737686]">
                  {rootInput.length > 0 ? `${rootInput.length}/3000 ký tự` : ''}
                </span>
                <Button
                  type="submit"
                  variant="secondary"
                  size="sm"
                  loading={submittingRoot}
                  disabled={!rootInput.trim()}
                  className="rounded-xl px-4 py-1.5"
                >
                  Gửi câu hỏi
                </Button>
              </div>
            </div>
          </div>
        </form>
      ) : (
        <div className="p-4 bg-[#eff4ff]/60 border border-[#cbdbf5] rounded-2xl flex items-center justify-between gap-4 text-xs text-[#172554]">
          <div className="flex items-center gap-2">
            <span>🔒</span>
            <span>Vui lòng đăng nhập để tham gia hỏi đáp và trao đổi.</span>
          </div>
          <a
            href={`/login?callbackUrl=${encodeURIComponent(typeof window !== 'undefined' ? window.location.pathname : '')}`}
            className="px-3.5 py-1.5 bg-[#2563EB] hover:bg-[#1d4ed8] text-white font-bold rounded-xl transition shadow-xs shrink-0"
          >
            Đăng nhập ngay
          </a>
        </div>
      )}

      {/* Comment List */}
      {loading ? (
        <div className="py-8 flex flex-col items-center justify-center text-slate-400 gap-2">
          <div className="w-6 h-6 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin"></div>
          <span className="text-xs">Đang tải thảo luận...</span>
        </div>
      ) : comments.length === 0 ? (
        <div className="py-10 text-center text-slate-400 space-y-2">
          <p className="text-2xl">💡</p>
          <p className="text-xs font-semibold text-[#172554]">Chưa có thảo luận nào</p>
          <p className="text-[11px] text-[#737686]">
            Hãy là người đầu tiên đặt câu hỏi về nội dung bài giảng này!
          </p>
        </div>
      ) : (
        <div className="space-y-6 pt-2">
          {comments.map((comment) => {
            const isAuthor = currentUserId && comment.userId === currentUserId;
            const canDelete = isAuthor || isLeaderOrAdmin;
            const isReplyingThis = replyingToId === comment.id;

            return (
              <div key={comment.id} className="space-y-3 group">
                {/* Root Comment Container */}
                <div className="flex items-start gap-3">
                  <div
                    className={`w-9 h-9 rounded-full bg-gradient-to-br ${getAvatarBg(
                      comment.userEmail
                    )} text-white flex items-center justify-center text-xs font-bold shrink-0 shadow-xs`}
                  >
                    {getInitials(comment.userEmail)}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="bg-[#f8f9ff] border border-[#eff4ff] hover:border-[#cbdbf5]/80 rounded-2xl p-3.5 transition space-y-1.5 shadow-2xs">
                      {/* Commenter Header */}
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold text-[#172554]">
                            {comment.userEmail.split('@')[0]}
                          </span>
                          {renderRoleBadge(comment.userRole)}
                        </div>
                        <span className="text-[10px] text-[#737686]">
                          {formatRelativeTime(comment.createdAt)}
                        </span>
                      </div>

                      {/* Content */}
                      <p className="text-xs text-[#2b2e3c] leading-relaxed whitespace-pre-line break-words">
                        {comment.content}
                      </p>
                    </div>

                    {/* Action Buttons: Reply, Delete */}
                    <div className="flex items-center gap-3 mt-1.5 px-2 text-[11px]">
                      {accessToken && (
                        <button
                          type="button"
                          onClick={() => {
                            if (isReplyingThis) {
                              setReplyingToId(null);
                              setReplyInput('');
                            } else {
                              setReplyingToId(comment.id);
                              setReplyInput(`@${comment.userEmail.split('@')[0]} `);
                            }
                          }}
                          className="font-bold text-[#2563EB] hover:text-[#1d4ed8] transition"
                        >
                          {isReplyingThis ? 'Hủy phản hồi' : '💬 Trả lời'}
                        </button>
                      )}

                      {canDelete && (
                        <button
                          type="button"
                          disabled={deletingId === comment.id}
                          onClick={() => handleDeleteComment(comment.id)}
                          className="text-[#737686] hover:text-red-600 transition disabled:opacity-50"
                        >
                          {deletingId === comment.id ? 'Đang xóa...' : 'Xóa'}
                        </button>
                      )}
                    </div>

                    {/* Inline Reply Input */}
                    {isReplyingThis && (
                      <form
                        onSubmit={(e) => handleSendReply(comment.id, e)}
                        className="mt-3 ml-2 flex items-start gap-2.5 animate-fadeIn"
                      >
                        <div
                          className={`w-7 h-7 rounded-full bg-gradient-to-br ${getAvatarBg(
                            currentUser?.email || ''
                          )} text-white flex items-center justify-center text-[10px] font-bold shrink-0 shadow-xs`}
                        >
                          {getInitials(currentUser?.email || '')}
                        </div>
                        <div className="flex-1 min-w-0">
                          <textarea
                            autoFocus
                            value={replyInput}
                            onChange={(e) => setReplyInput(e.target.value)}
                            placeholder={`Trả lời ${comment.userEmail.split('@')[0]}...`}
                            rows={2}
                            className="w-full px-3 py-2 bg-white border border-[#2563EB] focus:outline-none rounded-xl text-xs text-[#172554] placeholder-[#737686] transition resize-none leading-relaxed shadow-xs"
                          />
                          <div className="flex items-center justify-end gap-2 mt-1">
                            <button
                              type="button"
                              onClick={() => {
                                setReplyingToId(null);
                                setReplyInput('');
                              }}
                              className="px-2.5 py-1 text-[11px] text-[#737686] hover:text-[#172554] rounded-lg transition"
                            >
                              Hủy
                            </button>
                            <Button
                              type="submit"
                              variant="secondary"
                              size="sm"
                              loading={submittingReply}
                              disabled={!replyInput.trim()}
                              className="rounded-lg px-3 py-1 text-xs"
                            >
                              Gửi
                            </Button>
                          </div>
                        </div>
                      </form>
                    )}

                    {/* Nested Replies (Facebook 2-level style) */}
                    {comment.replies && comment.replies.length > 0 && (
                      <div className="mt-3.5 space-y-3 pl-3 md:pl-5 border-l-2 border-[#eff4ff]">
                        {comment.replies.map((reply) => {
                          const isReplyAuthor =
                            currentUserId && reply.userId === currentUserId;
                          const canDeleteReply = isReplyAuthor || isLeaderOrAdmin;

                          return (
                            <div key={reply.id} className="flex items-start gap-2.5 group/reply">
                              <div
                                className={`w-7 h-7 rounded-full bg-gradient-to-br ${getAvatarBg(
                                  reply.userEmail
                                )} text-white flex items-center justify-center text-[10px] font-bold shrink-0 shadow-2xs`}
                              >
                                {getInitials(reply.userEmail)}
                              </div>

                              <div className="flex-1 min-w-0">
                                <div className="bg-white border border-[#eff4ff] hover:border-[#cbdbf5]/80 rounded-2xl p-3 transition space-y-1 shadow-2xs">
                                  <div className="flex items-center justify-between gap-2 flex-wrap">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="text-[11px] font-bold text-[#172554]">
                                        {reply.userEmail.split('@')[0]}
                                      </span>
                                      {renderRoleBadge(reply.userRole)}
                                    </div>
                                    <span className="text-[10px] text-[#737686]">
                                      {formatRelativeTime(reply.createdAt)}
                                    </span>
                                  </div>

                                  <p className="text-xs text-[#2b2e3c] leading-relaxed whitespace-pre-line break-words">
                                    {reply.content}
                                  </p>
                                </div>

                                <div className="flex items-center gap-3 mt-1 px-2 text-[10px]">
                                  {accessToken && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setReplyingToId(comment.id);
                                        setReplyInput(`@${reply.userEmail.split('@')[0]} `);
                                      }}
                                      className="font-bold text-[#2563EB] hover:text-[#1d4ed8] transition"
                                    >
                                      💬 Trả lời
                                    </button>
                                  )}

                                  {canDeleteReply && (
                                    <button
                                      type="button"
                                      disabled={deletingId === reply.id}
                                      onClick={() => handleDeleteComment(reply.id, comment.id)}
                                      className="text-[#737686] hover:text-red-600 transition disabled:opacity-50"
                                    >
                                      {deletingId === reply.id ? 'Đang xóa...' : 'Xóa'}
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
