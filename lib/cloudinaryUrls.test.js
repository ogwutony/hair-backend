const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rewriteCloudinaryUrls, changedTopLevelFields } = require('./cloudinaryUrls');

class FakeObjectId { constructor(id) { this.id = id; } }

test('rewrites links nested in strings, arrays and objects', () => {
  const id = new FakeObjectId('abc');
  const when = new Date(0);
  const doc = {
    _id: id,
    createdAt: when,
    mediaUrls: ['https://res.cloudinary.com/old1/image/upload/v1/user_media/a.jpg', 'https://example.com/b.jpg'],
    videoUrl: 'https://res.cloudinary.com/old1/video/upload/v1/user_media/c.mp4',
    comments: [{ imageUrls: ['https://res.cloudinary.com/old1/image/upload/majority-hair/comments/d.jpg'] }],
    partner: { media: [{ url: 'https://res.cloudinary.com/old1/image/upload/e.jpg' }] },
    desc: 'see https://res.cloudinary.com/old1/image/upload/f.jpg here',
  };
  const { value, changed, count } = rewriteCloudinaryUrls(doc, 'old1', 'new2');
  assert.equal(changed, true);
  assert.equal(count, 5);
  assert.equal(value.mediaUrls[0], 'https://res.cloudinary.com/new2/image/upload/v1/user_media/a.jpg');
  assert.equal(value.mediaUrls[1], 'https://example.com/b.jpg');
  assert.equal(value.partner.media[0].url, 'https://res.cloudinary.com/new2/image/upload/e.jpg');
  assert.equal(value.desc, 'see https://res.cloudinary.com/new2/image/upload/f.jpg here');
  assert.equal(value._id, id);
  assert.equal(value.createdAt, when);
  assert.equal(doc.videoUrl.includes('/old1/'), true, 'input is not mutated');
});

test('does not touch other cloud names that merely start with the same text', () => {
  const { changed } = rewriteCloudinaryUrls({ u: 'https://res.cloudinary.com/old10/image/upload/a.jpg' }, 'old1', 'new2');
  assert.equal(changed, false);
});

test('rewrites private CDN hosts too', () => {
  const { value } = rewriteCloudinaryUrls({ u: 'https://old1-res.cloudinary.com/image/upload/a.jpg' }, 'old1', 'new2');
  assert.equal(value.u, 'https://new2-res.cloudinary.com/image/upload/a.jpg');
});

test('rejects invalid cloud names', () => {
  assert.throws(() => rewriteCloudinaryUrls({}, 'old1', 'bad/name'));
  assert.throws(() => rewriteCloudinaryUrls({}, '', 'new2'));
});

test('changedTopLevelFields returns only changed fields and never _id', () => {
  const before = { _id: 1, a: ['x'], b: 'same' };
  const after = { _id: 1, a: ['y'], b: 'same' };
  assert.deepEqual(changedTopLevelFields(before, after), { a: ['y'] });
});
