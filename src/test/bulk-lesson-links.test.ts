import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { lessonTitleFromVideo, parseBulkYoutubeLinks } from '../lib/bulk-lesson-links'

describe('parseBulkYoutubeLinks', () => {
  it('giữ đúng thứ tự dòng, bỏ dòng trống, chấp nhận nhiều dạng link và ID thô', () => {
    const rows = parseBulkYoutubeLinks(
      [
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        '',
        '  https://youtu.be/aaaaaaaaaaa  ',
        'https://www.youtube.com/shorts/bbbbbbbbbbb',
        'ccccccccccc',
      ].join('\r\n')
    )
    assert.deepEqual(rows.map((r) => r.videoId), ['dQw4w9WgXcQ', 'aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'])
    assert.deepEqual(rows.map((r) => r.line), [1, 3, 4, 5])
    assert.ok(rows.every((r) => r.status === 'ok'))
  })

  it('đánh dấu dòng không hợp lệ', () => {
    const rows = parseBulkYoutubeLinks('hello world\nhttps://example.com/x')
    assert.deepEqual(rows.map((r) => r.status), ['invalid', 'invalid'])
  })

  it('tự bỏ link lặp (giữ lần đầu) và link đã có trong khóa học', () => {
    const rows = parseBulkYoutubeLinks(
      'https://youtu.be/aaaaaaaaaaa\nhttps://www.youtube.com/watch?v=aaaaaaaaaaa&t=5\nbbbbbbbbbbb\nccccccccccc',
      ['bbbbbbbbbbb']
    )
    assert.deepEqual(rows.map((r) => r.status), ['ok', 'duplicate_in_list', 'duplicate_existing', 'ok'])
  })
})

describe('lessonTitleFromVideo', () => {
  it('dùng tên video, cắt tối đa 255 ký tự, có dự phòng khi rỗng', () => {
    assert.equal(lessonTitleFromVideo('  Bài 1 '), 'Bài 1')
    assert.equal(lessonTitleFromVideo('x'.repeat(300)).length, 255)
    assert.equal(lessonTitleFromVideo(''), 'Video YouTube')
    assert.equal(lessonTitleFromVideo(undefined), 'Video YouTube')
  })
})
