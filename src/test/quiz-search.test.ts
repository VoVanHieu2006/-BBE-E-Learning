import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { SearchableCourseSession, getHighlightSegments, matchQuizQuestion, normalizeVietnameseSearch, searchCourseQuestions } from '../lib/quiz-search'

const joined = (text: string, query: string) => getHighlightSegments(text, query).map(segment => segment.text).join('')

describe('chuẩn hóa từ khóa tìm kiếm tiếng Việt', () => {
  it('bỏ dấu, đổi đ/Đ thành d, viết thường, gộp khoảng trắng', () => {
    assert.equal(normalizeVietnameseSearch('Kỹ năng  GIAO tiếp '), 'ky nang giao tiep')
    assert.equal(normalizeVietnameseSearch('Đàm phán đường dài'), 'dam phan duong dai')
    assert.equal(normalizeVietnameseSearch('Kỹ\n\tnăng'), 'ky nang')
    assert.equal(normalizeVietnameseSearch('  \n\t '), '')
  })
  it('chữ có dấu dạng tổ hợp (NFD) cho cùng kết quả', () => {
    assert.equal(normalizeVietnameseSearch('Kỹ năng đàm phán'.normalize('NFD')), 'ky nang dam phan')
  })
})

describe('tìm câu hỏi trong một quiz', () => {
  const question = {
    questionText: 'Kỹ năng lắng nghe là gì?', explanation: 'Lắng nghe chủ động giúp thấu hiểu khách hàng.', poolIndex: 1, poolId: 'pool-b',
    options: [{ optionText: 'Đặt câu hỏi mở' }, { optionText: 'Ngắt lời khách hàng' }],
  }
  const none = { matched: false, matchedIn: [], matchedSnippet: null }

  it('từ khóa rỗng khớp mọi câu', () => {
    for (const query of ['', '   ']) assert.deepEqual(matchQuizQuestion(question, query), { matched: true, matchedIn: [], matchedSnippet: null })
  })
  it('tìm trong nội dung câu hỏi, không phân biệt dấu và hoa thường', () => {
    assert.deepEqual(matchQuizQuestion(question, 'ky nang'), { matched: true, matchedIn: ['question'], matchedSnippet: 'Kỹ năng lắng nghe là gì?' })
    assert.deepEqual(matchQuizQuestion(question, 'KỸ NĂNG'), { matched: true, matchedIn: ['question'], matchedSnippet: 'Kỹ năng lắng nghe là gì?' })
    assert.equal(matchQuizQuestion({ questionText: 'Ky nang ban hang', options: [] }, 'kỹ năng').matched, true)
  })
  it('tìm trong đáp án', () => {
    assert.deepEqual(matchQuizQuestion(question, 'cau hoi mo'), { matched: true, matchedIn: ['option'], matchedSnippet: 'Đặt câu hỏi mở' })
  })
  it('tìm trong giải thích', () => {
    assert.deepEqual(matchQuizQuestion(question, 'thấu hiểu'), { matched: true, matchedIn: ['explanation'], matchedSnippet: 'Lắng nghe chủ động giúp thấu hiểu khách hàng.' })
  })
  it('khớp nhiều nơi: liệt kê đủ, đoạn trích lấy từ nơi khớp đầu tiên', () => {
    assert.deepEqual(matchQuizQuestion(question, 'LANG NGHE'), { matched: true, matchedIn: ['question', 'explanation'], matchedSnippet: 'Kỹ năng lắng nghe là gì?' })
    assert.deepEqual(matchQuizQuestion(question, 'khach hang'), { matched: true, matchedIn: ['option', 'explanation'], matchedSnippet: 'Ngắt lời khách hàng' })
  })
  it('không khớp và câu không có giải thích', () => {
    assert.deepEqual(matchQuizQuestion(question, 'python'), none)
    assert.deepEqual(matchQuizQuestion({ ...question, explanation: null }, 'thấu hiểu'), none)
  })
  it('lọc theo nhóm bằng vị trí nhóm hoặc ID nhóm', () => {
    assert.equal(matchQuizQuestion(question, '', 1).matched, true)
    assert.deepEqual(matchQuizQuestion(question, '', 0), none)
    assert.equal(matchQuizQuestion(question, 'ky nang', 'pool-b').matched, true)
    assert.deepEqual(matchQuizQuestion(question, 'ky nang', 'pool-a'), none)
    assert.equal(matchQuizQuestion(question, 'ky nang', null).matched, true)
    assert.deepEqual(matchQuizQuestion(question, 'python', 1), none)
  })
  it('câu chưa gán nhóm được coi là thuộc nhóm đầu tiên', () => {
    const unassigned = { questionText: 'Câu hỏi', options: [] }
    assert.equal(matchQuizQuestion(unassigned, '', 0).matched, true)
    assert.equal(matchQuizQuestion(unassigned, '', 1).matched, false)
  })
  it('nội dung dài: đoạn trích chỉ lấy quanh chỗ khớp', () => {
    const long = ('A'.repeat(100) + ' kỹ năng ' + 'B'.repeat(100)).normalize('NFC')
    assert.equal(matchQuizQuestion({ questionText: long, options: [] }, 'ky nang').matchedSnippet, ('…' + 'A'.repeat(39) + ' kỹ năng ' + 'B'.repeat(39) + '…').normalize('NFC'))
  })
})

describe('tô sáng từ khóa nhưng giữ nguyên chữ có dấu', () => {
  const text = 'Kỹ năng bán hàng và kỹ năng đàm phán'
  it('tô sáng mọi chỗ khớp', () => {
    assert.deepEqual(getHighlightSegments(text, 'ky nang'), [
      { text: 'Kỹ năng', match: true }, { text: ' bán hàng và ', match: false }, { text: 'kỹ năng', match: true }, { text: ' đàm phán', match: false },
    ])
  })
  it('từ khóa có dấu, viết hoa vẫn tô đúng chữ gốc', () => {
    assert.deepEqual(getHighlightSegments(text, 'ĐÀM PHÁN'), [{ text: 'Kỹ năng bán hàng và kỹ năng ', match: false }, { text: 'đàm phán', match: true }])
    assert.deepEqual(getHighlightSegments('Đường đi', 'duong'), [{ text: 'Đường', match: true }, { text: ' đi', match: false }])
  })
  it('không khớp hoặc từ khóa rỗng: trả nguyên văn bản, không tô', () => {
    assert.deepEqual(getHighlightSegments(text, 'python'), [{ text, match: false }])
    assert.deepEqual(getHighlightSegments(text, '  '), [{ text, match: false }])
    assert.deepEqual(getHighlightSegments('', 'ky'), [])
  })
  it('văn bản dạng tổ hợp (NFD): tô trọn cả dấu đi kèm', () => {
    const decomposed = 'Kỹ năng'.normalize('NFD')
    assert.deepEqual(getHighlightSegments(decomposed + ' mềm', 'ky nang'), [{ text: decomposed, match: true }, { text: ' mềm', match: false }])
  })
  it('nhiều khoảng trắng liền nhau vẫn khớp', () => {
    assert.deepEqual(getHighlightSegments('Kỹ   năng', 'ky nang'), [{ text: 'Kỹ   năng', match: true }])
  })
  it('ghép các đoạn lại luôn ra đúng văn bản gốc', () => {
    for (const [value, query] of [[text, 'n'], [text, 'ky nang'], ['  Đáp án   đúng  ', 'dap an dung'], ['aaaa', 'aa'], [text.normalize('NFD'), 'ang']]) {
      assert.equal(joined(value, query), value)
    }
  })
})

describe('tìm câu hỏi trên toàn khóa học', () => {
  const sessions: SearchableCourseSession[] = [
    { id: 's1', title: 'Buổi 1', lessons: [
      { id: 'l1', title: 'Bài 1', assessment: { pools: [{ id: 'p1', name: 'Nhóm A' }, { id: 'p2', name: 'Nhóm B' }], questions: [
        { id: 'q1', questionText: 'Thủ đô của Việt Nam?', explanation: null, poolId: 'p1', options: [{ optionText: 'Hà Nội' }, { optionText: 'Huế' }] },
        { id: 'q2', questionText: 'Kỹ năng bán hàng?', explanation: 'Lắng nghe khách hàng', poolId: 'p2', options: [{ optionText: 'Có' }, { optionText: 'Không' }] },
      ] } },
      { id: 'l2', title: 'Bài 2', assessment: null },
    ] },
    { id: 's2', title: 'Buổi 2', lessons: [
      { id: 'l3', title: 'Bài 3', assessment: { pools: [], questions: [{ questionText: 'Hà Nội có bao nhiêu quận?', options: [{ optionText: '12' }, { optionText: '30' }] }] } },
    ] },
  ]

  it('trả kết quả phẳng theo thứ tự Buổi › Bài › Câu, kèm nhóm và đoạn trích', () => {
    assert.deepEqual(searchCourseQuestions(sessions, 'ha noi'), [
      { sessionId: 's1', sessionTitle: 'Buổi 1', lessonId: 'l1', lessonTitle: 'Bài 1', poolName: 'Nhóm A', poolIndex: 0, questionId: 'q1', questionIndex: 0, questionText: 'Thủ đô của Việt Nam?', matchedIn: ['option'], matchedSnippet: 'Hà Nội' },
      { sessionId: 's2', sessionTitle: 'Buổi 2', lessonId: 'l3', lessonTitle: 'Bài 3', poolName: null, poolIndex: null, questionId: null, questionIndex: 0, questionText: 'Hà Nội có bao nhiêu quận?', matchedIn: ['question'], matchedSnippet: 'Hà Nội có bao nhiêu quận?' },
    ])
  })
  it('vị trí câu là vị trí gốc trong ngân hàng của bài, không phải vị trí trong kết quả', () => {
    assert.deepEqual(searchCourseQuestions(sessions, 'khach hang'), [
      { sessionId: 's1', sessionTitle: 'Buổi 1', lessonId: 'l1', lessonTitle: 'Bài 1', poolName: 'Nhóm B', poolIndex: 1, questionId: 'q2', questionIndex: 1, questionText: 'Kỹ năng bán hàng?', matchedIn: ['explanation'], matchedSnippet: 'Lắng nghe khách hàng' },
    ])
  })
  it('từ khóa rỗng hoặc không khớp: không có kết quả', () => {
    assert.deepEqual(searchCourseQuestions(sessions, '  '), [])
    assert.deepEqual(searchCourseQuestions(sessions, 'python'), [])
  })
  it('câu hỏi trong form (dùng vị trí nhóm thay cho ID nhóm) vẫn ra đúng tên nhóm', () => {
    const [result] = searchCourseQuestions([{ title: 'Buổi', lessons: [{ title: 'Bài', assessment: { pools: [{ name: 'A' }, { name: 'B' }], questions: [{ questionText: 'abc', poolIndex: 1, options: [] }] } }] }], 'ABC')
    assert.equal(result.poolName, 'B')
    assert.equal(result.poolIndex, 1)
  })
})
