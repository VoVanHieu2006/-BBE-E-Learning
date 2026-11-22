import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildGoogleExportUrl, extractGoogleDocRef, parseCsv, parseQuizCsv, parseQuizRows, parseQuizText } from '../lib/quiz/import'

// Admin pastes a Google Sheet/Doc link to load quiz questions. Columns follow the template linked in the course editor:
// Câu hỏi | A | B | C | D | Đáp án | Giải thích
const ID = '1HhM0S2agnLMWz9MQYCswyGL1W8SeplN0DiNMFWYNa20'

describe('link Google Sheet/Doc (chống SSRF: máy chủ chỉ tải từ docs.google.com)', () => {
  it('reads the document id, gid and sheet name from a Sheet link', () => {
    assert.deepEqual(extractGoogleDocRef(`https://docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing`), { kind: 'sheet', id: ID, gid: undefined, sheetName: undefined })
    assert.equal(extractGoogleDocRef(`https://docs.google.com/spreadsheets/d/${ID}/edit?gid=42`)?.gid, '42')
    assert.equal(extractGoogleDocRef(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=77`)?.gid, '77')
    assert.equal(extractGoogleDocRef(`https://docs.google.com/spreadsheets/d/${ID}/edit?sheet=Bài 1`)?.sheetName, 'Bài 1')
    assert.equal(extractGoogleDocRef(`  https://docs.google.com/spreadsheets/d/${ID}/edit  `)?.id, ID)
  })
  it('recognises a Google Doc link', () => {
    assert.deepEqual(extractGoogleDocRef(`https://docs.google.com/document/d/${ID}/edit`), { kind: 'doc', id: ID, gid: undefined, sheetName: undefined })
  })
  for (const url of [
    '', 'không phải link', `https://evil.example.com/spreadsheets/d/${ID}/edit`, `https://docs.google.com.evil.example/spreadsheets/d/${ID}`,
    `https://evil.example/?u=https://docs.google.com/spreadsheets/d/${ID}`, `https://docs.google.com@evil.example/spreadsheets/d/${ID}`,
    'http://169.254.169.254/latest/meta-data', 'http://localhost:3000/api/internal', 'file:///etc/passwd', 'https://docs.google.com/forms/d/abc/edit',
    'https://drive.google.com/file/d/abc/view', 'https://docs.google.com/spreadsheets/d/', `https://docs.google.com/spreadsheets/d/${ID}/../../evil`,
  ]) it(`rejects ${url || '(rỗng)'}`, () => assert.equal(extractGoogleDocRef(url), null))
  it('builds the export URL only from the validated id, never from the pasted URL', () => {
    assert.equal(buildGoogleExportUrl({ kind: 'doc', id: ID }), `https://docs.google.com/document/d/${ID}/export?format=txt`)
    assert.equal(buildGoogleExportUrl({ kind: 'sheet', id: ID }), `https://docs.google.com/spreadsheets/d/${ID}/export?format=csv`)
    assert.equal(buildGoogleExportUrl({ kind: 'sheet', id: ID, gid: '42' }), `https://docs.google.com/spreadsheets/d/${ID}/export?format=csv&gid=42`)
    assert.equal(buildGoogleExportUrl({ kind: 'sheet', id: ID, sheetName: 'Bài 1&x=1' }), `https://docs.google.com/spreadsheets/d/${ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent('Bài 1&x=1')}`)
    const hostile = extractGoogleDocRef(`https://docs.google.com/spreadsheets/d/${ID}/edit?gid=1%26redirect=http://evil.example`)
    assert.ok(hostile)
    assert.ok(buildGoogleExportUrl(hostile).startsWith(`https://docs.google.com/spreadsheets/d/${ID}/export?format=csv&gid=`))
    assert.ok(!buildGoogleExportUrl(hostile).includes('&redirect='))
  })
})

describe('đọc CSV', () => {
  it('keeps commas, quotes and line breaks that are inside a quoted cell', () => {
    assert.deepEqual(parseCsv('a,"b, c","d ""e"" f","dòng 1\ndòng 2"\n1,2,3,4'), [['a', 'b, c', 'd "e" f', 'dòng 1\ndòng 2'], ['1', '2', '3', '4']])
  })
  it('accepts a BOM, Windows line endings and a missing final newline; drops blank rows', () => {
    assert.deepEqual(parseCsv('\uFEFFa,b\r\n\r\n , \r\nc,d'), [['a', 'b'], ['c', 'd']])
    assert.deepEqual(parseCsv(''), [])
  })
})

const HEADER = 'Câu hỏi,A,B,C,D,"Đáp án (A hoặc A,C)",Giải thích'
describe('đọc câu hỏi', () => {
  it('reads the published template: header skipped, one correct option, explanation kept, one point each', () => {
    const { questions, errors } = parseQuizCsv(`${HEADER}\nSứ mệnh là gì?,Lý do tồn tại,Báo cáo,Kế hoạch,Danh sách,A,"Sứ mệnh xác định lý do tồn tại, mục đích"`)
    assert.deepEqual(errors, [])
    assert.deepEqual(questions, [{
      questionText: 'Sứ mệnh là gì?', questionType: 'SINGLE_CHOICE', points: 1, explanation: 'Sứ mệnh xác định lý do tồn tại, mục đích', sortOrder: 0,
      options: [
        { optionText: 'Lý do tồn tại', isCorrect: true, sortOrder: 0 }, { optionText: 'Báo cáo', isCorrect: false, sortOrder: 1 },
        { optionText: 'Kế hoạch', isCorrect: false, sortOrder: 2 }, { optionText: 'Danh sách', isCorrect: false, sortOrder: 3 },
      ],
    }])
  })
  it('several answers make a multiple-choice question; separators , ; / and spaces, any letter case, duplicates ignored', () => {
    for (const answer of ['"A,C"', 'a;c', 'A / C', 'c a', '"A, C, A"']) {
      const { questions, errors } = parseQuizCsv(`Câu 1,x,y,z,w,${answer},`)
      assert.deepEqual(errors, [], answer)
      assert.equal(questions[0].questionType, 'MULTIPLE_CHOICE', answer)
      assert.deepEqual(questions[0].options.map((option) => option.isCorrect), [true, false, true, false], answer)
    }
    assert.equal(parseQuizCsv('Câu 1,x,y,z,w,"B,B",').questions[0].questionType, 'SINGLE_CHOICE')
  })
  it('accepts a two-option question and a sheet without a header row', () => {
    const { questions, errors } = parseQuizCsv('Đúng hay sai?,Đúng,Sai,,,B,')
    assert.deepEqual(errors, [])
    assert.deepEqual(questions[0].options, [{ optionText: 'Đúng', isCorrect: false, sortOrder: 0 }, { optionText: 'Sai', isCorrect: true, sortOrder: 1 }])
  })
  it('reports each bad row with the row number Admin sees in the sheet, and still loads the good rows', () => {
    const { questions, errors } = parseQuizCsv([
      HEADER,
      ',a,b,c,d,A,',            // row 2: no question
      'Câu 3,chỉ một,,,,A,',    // row 3: one option
      'Câu 4,a,b,c,d,,',        // row 4: no answer
      'Câu 5,a,b,,,C,',         // row 5: answer outside the options
      'Câu 6,a,b,c,d,E,',       // row 6: letter that does not exist
      'Câu 7,a,b,c,d,D,ok',     // row 7: valid
    ].join('\n'))
    assert.deepEqual(errors.map((error) => error.row), [2, 3, 4, 5, 6])
    assert.match(errors[0].message, /Thiếu nội dung câu hỏi/)
    assert.match(errors[1].message, /ít nhất 2 lựa chọn/)
    assert.match(errors[2].message, /Thiếu đáp án đúng/)
    assert.match(errors[3].message, /"C" không khớp các lựa chọn có sẵn \(A, B\)/)
    assert.match(errors[4].message, /"E" không khớp/)
    assert.deepEqual(questions.map((question) => [question.questionText, question.sortOrder]), [['Câu 7', 0]])
  })
  it('row numbers start at 1 when the sheet has no header', () => {
    assert.deepEqual(parseQuizCsv(',a,b,,,A,\nCâu 2,a,b,,,A,').errors.map((error) => error.row), [1])
  })
  it('every error message is Vietnamese', () => {
    const { errors } = parseQuizRows([[''], ['q', 'a'], ['q', 'a', 'b'], ['q', 'a', 'b', '', '', 'Z']])
    assert.equal(errors.length, 4)
    for (const error of errors) assert.match(error.message, /[\u00C0-\u1EF9]/)
  })
  it('reads a Google Doc export: one question per line, cells split by | or tab', () => {
    const { questions, errors } = parseQuizText('\uFEFFCâu hỏi | A | B | C | D | Đáp án | Giải thích\r\n\r\nThủ đô Việt Nam? | Hà Nội | Huế | Đà Nẵng | Cần Thơ | A | Vì vậy\r\nCâu 2\tx\ty\t\t\tB\t')
    assert.deepEqual(errors, [])
    assert.deepEqual(questions.map((question) => [question.questionText, question.options.length, question.options.findIndex((option) => option.isCorrect), question.explanation]), [['Thủ đô Việt Nam?', 4, 0, 'Vì vậy'], ['Câu 2', 2, 1, '']])
  })
  it('never loads a question without a correct option', () => {
    const { questions } = parseQuizCsv(['q1,a,b,c,d,A,', 'q2,a,b,c,d,"B,D",', 'q3,a,b,,,B,'].join('\n'))
    assert.equal(questions.length, 3)
    for (const question of questions) assert.ok(question.options.some((option) => option.isCorrect))
  })
  it('an empty option column must not shift the answer key onto another option', () => {
    // Sheet row: A = "Hà Nội", B empty, C = "Huế", D = "Đà Nẵng", answer C. The correct option is "Huế" (or the row is rejected).
    const { questions, errors } = parseQuizCsv('Câu 1,Hà Nội,,Huế,Đà Nẵng,C,')
    const marked = questions[0]?.options.filter((option) => option.isCorrect).map((option) => option.optionText)
    assert.ok(errors.length === 1 || marked?.join() === 'Huế', `đáp án C ("Huế") bị gán thành: ${marked?.join()}`)
  })
  it('rejects an answer letter that points at an empty option column', () => {
    const { questions, errors } = parseQuizCsv('Câu 1,Hà Nội,,Huế,Đà Nẵng,B,')
    assert.equal(questions.length, 0)
    assert.deepEqual(errors.map((error) => error.row), [1])
    assert.match(errors[0].message, /A, C, D/)
  })
})
