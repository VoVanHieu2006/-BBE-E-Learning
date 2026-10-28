'use client';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { LessonDocumentUpload, LessonDocumentList } from './LessonDocuments';
import type { CourseEditorState } from './useCourseEditor';

type Props = Pick<CourseEditorState,
  'course' |
  'isPublished' |
  'openAddSessionModal' |
  'handleMoveSession' |
  'openEditSessionModal' |
  'openAddLessonModal' |
  'handleDeleteSession' |
  'handleMoveLesson' |
  'openAssessmentEditorForLesson' |
  'openEditLessonModal' |
  'handleDirectUploadDoc' |
  'uploadingDocForLessonId' |
  'handleDeleteLesson' |
  'handleDeleteDocument'
>;

export default function CourseOutline({
  course,
  isPublished,
  openAddSessionModal,
  handleMoveSession,
  openEditSessionModal,
  openAddLessonModal,
  handleDeleteSession,
  handleMoveLesson,
  openAssessmentEditorForLesson,
  openEditLessonModal,
  handleDirectUploadDoc,
  uploadingDocForLessonId,
  handleDeleteLesson,
  handleDeleteDocument
}: Props) {
  return (
    <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
                    Chương trình & Buổi học ({course.sessions?.length || 0})
                  </h2>
                  <p className="text-xs text-[#737686]">
                    Quản lý các buổi học, bài giảng video YouTube và tài liệu đính kèm (tối đa 25MB/tài liệu)
                  </p>
                </div>
                <Button
                  size="sm"
                  disabled={isPublished}
                  onClick={openAddSessionModal}
                >
                  ＋ Thêm buổi học
                </Button>
              </div>

              {course.sessions?.length === 0 ? (
                <Card className="text-center py-12 border-dashed border-2 border-slate-200">
                  <p className="text-base font-semibold text-[#172554] mb-2">Chưa có buổi học nào</p>
                  <p className="text-xs text-[#737686] mb-4">Khóa học cần ít nhất 1 buổi học trước khi có thể công khai.</p>
                  <Button size="sm" disabled={isPublished} onClick={openAddSessionModal}>
                    ＋ Tạo buổi học đầu tiên
                  </Button>
                </Card>
              ) : (
                <div className="space-y-4">
                  {course.sessions?.map((session: any, sIdx: number) => {
                    const sId = session.sessionId || session.id;

                    return (
                      <details key={sId} className="rounded-2xl border border-[#eff4ff] bg-white p-6 shadow-sm">
                        <summary className="flex cursor-pointer list-none items-start justify-between gap-4 flex-wrap sm:flex-nowrap">
                          <div className="flex items-start gap-3 min-w-0 flex-1">
                            <span className="w-7 h-7 bg-[#2563EB] text-white rounded-lg flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                              {sIdx + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                              <h3 className="text-base font-bold text-[#172554] break-words line-clamp-2" title={session.title}>{session.title}</h3>
                              {session.description && (
                                <p className="text-xs text-[#737686] mt-0.5 leading-relaxed break-words">{session.description}</p>
                              )}
                            </div>
                          </div>

                          {!isPublished && (
                            <div className="flex items-center gap-2 shrink-0 flex-wrap" onClick={(event) => { event.preventDefault(); event.stopPropagation(); }}>
                              {sIdx > 0 && (
                                <button
                                  type="button"
                                  onClick={() => handleMoveSession(sIdx, 'up')}
                                  className="p-1 text-slate-400 hover:text-[#2563EB]"
                                  title="Di chuyển buổi học lên"
                                >
                                  ▲
                                </button>
                              )}
                              {sIdx < course.sessions.length - 1 && (
                                <button
                                  type="button"
                                  onClick={() => handleMoveSession(sIdx, 'down')}
                                  className="p-1 text-slate-400 hover:text-[#2563EB]"
                                  title="Di chuyển buổi học xuống"
                                >
                                  ▼
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => openEditSessionModal(session)}
                                className="p-1.5 text-slate-400 hover:text-[#2563EB] rounded-lg hover:bg-blue-50 transition"
                                title="Chỉnh sửa buổi học (tiêu đề & mô tả)"
                              >
                                ✏️
                              </button>
                              <Button size="sm" variant="secondary" onClick={() => openAddLessonModal(sId)}>
                                ＋ Thêm bài học
                              </Button>
                              <button
                                type="button"
                                onClick={() => handleDeleteSession(sId)}
                                className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50"
                                title="Xóa buổi học"
                              >
                                🗑️
                              </button>
                            </div>
                          )}
                        </summary>

                        {/* Lessons in session with Move Up/Down (Request 1) */}
                        <div className="mt-4 border-t border-[#eff4ff] pt-4">
                        {session.lessons?.length === 0 ? (
                          <div className="py-6 text-center text-xs text-[#737686] bg-[#f8f9ff] rounded-xl">
                            Chưa có bài học nào trong buổi này.
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {session.lessons?.map((lesson: any, lIdx: number) => {
                              const lId = lesson.lessonId || lesson.id;
                              const vidId = lesson.video?.youtubeVideoId || lesson.youtubeVideoId;
                              const durSec = lesson.video?.durationSeconds || lesson.durationSeconds || 0;
                              const durMin = Math.floor(durSec / 60);
                              const durRemSec = durSec % 60;

                              return (
                                <div
                                  key={lId}
                                  className="p-4 bg-[#f8f9ff] rounded-2xl border border-[#eff4ff] space-y-3"
                                >
                                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                    <div className="flex items-center gap-3 min-w-0 flex-1">
                                      <div className="flex flex-col items-center gap-0.5 shrink-0">
                                        <span className="text-xs font-bold text-[#737686]">
                                          {sIdx + 1}.{lIdx + 1}
                                        </span>
                                        {!isPublished && (
                                          <div className="flex flex-col gap-0.5">
                                            {lIdx > 0 && (
                                              <button
                                                type="button"
                                                onClick={() => handleMoveLesson(sId, lIdx, 'up')}
                                                className="text-[9px] text-slate-400 hover:text-[#2563EB] px-1 bg-white border border-[#cbdbf5] rounded"
                                                title="Di chuyển bài học lên"
                                              >
                                                ▲
                                              </button>
                                            )}
                                            {lIdx < (session.lessons?.length || 0) - 1 && (
                                              <button
                                                type="button"
                                                onClick={() => handleMoveLesson(sId, lIdx, 'down')}
                                                className="text-[9px] text-slate-400 hover:text-[#2563EB] px-1 bg-white border border-[#cbdbf5] rounded"
                                                title="Di chuyển bài học xuống"
                                              >
                                                ▼
                                              </button>
                                            )}
                                          </div>
                                        )}
                                      </div>

                                      {vidId && (
                                        <img
                                          src={`https://i.ytimg.com/vi/${vidId}/hqdefault.jpg`}
                                          alt="Thumb"
                                          className="w-14 h-9 object-cover rounded-md shrink-0 shadow-sm"
                                        />
                                      )}
                                      <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <h4 className="text-sm font-bold text-[#172554] break-words line-clamp-2" title={lesson.title}>{lesson.title}</h4>
                                          {lesson.assessment && (
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                                              📝 Quiz ({lesson.assessment.questionCount || 0} câu/lượt · {lesson.assessment.durationMinutes || 0} phút · ngân hàng {lesson.assessment.bankQuestionCount || lesson.assessment.questions?.length || 0})
                                            </span>
                                          )}
                                        </div>
                                        <p className="text-xs text-[#737686] truncate">
                                          Video YouTube: <span className="font-mono">{vidId}</span> • Thời lượng:{' '}
                                          {durSec > 0 ? `${durMin}:${durRemSec.toString().padStart(2, '0')} (${durSec}s)` : '—'}
                                        </p>
                                        {lesson.description && (
                                          <p className="text-xs text-[#434655] bg-white/80 px-2.5 py-1 rounded-lg border border-[#eff4ff] mt-1.5 leading-relaxed break-words">
                                            {lesson.description}
                                          </p>
                                        )}
                                      </div>
                                    </div>

                                    {!isPublished && (
                                      <div className="flex items-center gap-2 flex-wrap shrink-0">
                                        <button
                                          type="button"
                                          onClick={() => openAssessmentEditorForLesson(sId, lesson)}
                                          className={`px-2.5 py-1 border rounded-lg text-xs font-semibold inline-flex items-center gap-1 transition ${
                                            lesson.assessment
                                              ? 'bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100'
                                              : 'bg-white text-[#2563EB] border-[#cbdbf5] hover:bg-[#eff4ff]'
                                          }`}
                                          title="Cấu hình bài kiểm tra cho bài học này"
                                        >
                                          <span>📝</span>
                                          <span>{lesson.assessment ? 'Sửa Quiz' : '+ Thêm Quiz'}</span>
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => openEditLessonModal(sId, lesson)}
                                          className="p-1.5 text-slate-400 hover:text-[#2563EB] rounded-lg hover:bg-blue-50 transition"
                                          title="Chỉnh sửa bài học (tiêu đề, mô tả, video)"
                                        >
                                          ✏️
                                        </button>
                                        <LessonDocumentUpload sId={sId} lId={lId} handleDirectUploadDoc={handleDirectUploadDoc} uploadingDocForLessonId={uploadingDocForLessonId} />

                                        <button
                                          onClick={() => handleDeleteLesson(sId, lId)}
                                          className="p-1 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50"
                                          title="Xóa bài học"
                                        >
                                          ✕
                                        </button>
                                      </div>
                                    )}
                                  </div>

                                  {/* Documents List */}
                                  <LessonDocumentList sId={sId} lId={lId} lesson={lesson} isPublished={isPublished} handleDeleteDocument={handleDeleteDocument} />
                                </div>
                              );
                            })}
                          </div>
                        )}
                        </div>
                      </details>
                    );
                  })}
                </div>
              )}
            </div>
  );
}
