'use client';
import type { CourseEditorState } from './useCourseEditor';

type LessonDocumentUploadProps = Pick<CourseEditorState, 'handleDirectUploadDoc' | 'uploadingDocForLessonId'> & {
  sId: string;
  lId: string;
};

export function LessonDocumentUpload({ handleDirectUploadDoc, uploadingDocForLessonId, sId, lId }: LessonDocumentUploadProps) {
  return (
    <label className="cursor-pointer">
                                          <input
                                            type="file"
                                            multiple
                                            className="hidden"
                                            onChange={(e) => handleDirectUploadDoc(sId, lId, e)}
                                          />
                                          <span className="px-2.5 py-1 bg-white border border-[#cbdbf5] hover:bg-[#eff4ff] text-[#2563EB] rounded-lg text-xs font-semibold inline-block transition">
                                            {uploadingDocForLessonId === lId ? '⏳ Đang tải...' : '📎 Tài liệu'}
                                          </span>
                                        </label>
  );
}

type LessonDocumentListProps = Pick<CourseEditorState, 'isPublished' | 'handleDeleteDocument'> & {
  sId: string;
  lId: string;
  lesson: any;
};

export function LessonDocumentList({ isPublished, handleDeleteDocument, sId, lId, lesson }: LessonDocumentListProps) {
  return (lesson.documents?.length > 0 && (
                                    <div className="pt-2 border-t border-[#cbdbf5]/50 space-y-1.5">
                                      <span className="text-[11px] font-bold text-[#737686] uppercase tracking-wider">
                                        Tài liệu học tập ({lesson.documents.length}):
                                      </span>
                                      <div className="flex flex-wrap gap-2">
                                        {lesson.documents.map((doc: any) => {
                                          const dId = doc.documentId || doc.id;
                                          return (
                                            <div
                                              key={dId}
                                              className="flex items-center gap-1.5 px-3 py-1 bg-white border border-slate-200 rounded-xl text-xs text-[#172554] shadow-xs"
                                            >
                                              <span>📄</span>
                                              <span className="font-medium truncate max-w-[180px]">{doc.fileName}</span>
                                              {!isPublished && (
                                                <button
                                                  onClick={() => handleDeleteDocument(sId, lId, dId, doc.fileName)}
                                                  className="ml-1 text-slate-400 hover:text-red-600"
                                                >
                                                  ✕
                                                </button>
                                              )}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  ));
}
