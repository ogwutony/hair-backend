const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCloudinaryUrl, findCloudinaryUrls, contentTypeFor } = require('./mediaKeys');

test('plain video with version', () => {
  assert.deepEqual(parseCloudinaryUrl('https://res.cloudinary.com/du1azv5ip/video/upload/v1794754492/user_media/xh94.mp4'),
    { cloud: 'du1azv5ip', resourceType: 'video', key: 'video/user_media/xh94.mp4' });
});

test('strips transformations', () => {
  assert.equal(parseCloudinaryUrl('https://res.cloudinary.com/c/image/upload/c_limit,w_1080,q_auto,f_auto/v1794328335/user_media/a.jpg').key, 'image/user_media/a.jpg');
  assert.equal(parseCloudinaryUrl('https://res.cloudinary.com/c/video/upload/f_mp4,vc_h264/v1/user_media/b.mp4').key, 'video/user_media/b.mp4');
});

test('rejects other hosts and junk', () => {
  assert.equal(parseCloudinaryUrl('https://example.com/image/upload/v1/a.jpg'), null);
  assert.equal(parseCloudinaryUrl('not a url'), null);
});

test('findCloudinaryUrls walks nested documents and text', () => {
  const doc = { a: ['https://res.cloudinary.com/c/image/upload/v1/x.jpg'], b: { c: 'see https://res.cloudinary.com/c/video/upload/v2/y.mp4 now' }, d: 5 };
  assert.deepEqual([...findCloudinaryUrls(doc)].sort(), [
    'https://res.cloudinary.com/c/image/upload/v1/x.jpg',
    'https://res.cloudinary.com/c/video/upload/v2/y.mp4',
  ]);
});

test('contentTypeFor', () => {
  assert.equal(contentTypeFor('video/user_media/a.MOV'), 'video/quicktime');
  assert.equal(contentTypeFor('image/a.unknown'), 'application/octet-stream');
});
