// Public Google Drive links: ids from every link shape, folder view parsing, picture filtering, nested sub-folders with their path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { driveFolderId, driveFileId, parseFolderView, listDrive } from '../server/src/drive.mjs';

const entry = (id, name, folder = false) => `<div class="flip-entry" id="entry-${id}" tabindex="0" role="link"><div class="flip-entry-info"><a href="https://drive.google.com/${folder ? `drive/folders/${id}` : `file/d/${id}/view?usp=drive_web`}" target="_blank"><div class="flip-entry-visual"></div><div class="flip-entry-list-icon"></div><div class="flip-entry-title">${name}</div></a></div></div>`;

test('drive ids: folder and file links in their usual shapes', () => {
  assert.equal(driveFolderId('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp?usp=sharing'), '1AbCdEfGhIjKlMnOp');
  assert.equal(driveFolderId('https://drive.google.com/drive/u/0/folders/1AbCdEfGhIjKlMnOp'), '1AbCdEfGhIjKlMnOp');
  assert.equal(driveFileId('https://drive.google.com/file/d/1ZyXwVuTsRqPoNm/view?usp=sharing'), '1ZyXwVuTsRqPoNm');
  assert.equal(driveFileId('https://drive.google.com/open?id=1ZyXwVuTsRqPoNm'), '1ZyXwVuTsRqPoNm');
  assert.equal(driveFolderId('https://example.com/folders/x'), null);
});

test('folder view: entries, names unescaped, folders flagged', () => {
  const html = `<html><body>${entry('1aaaaaaaaaaa', 'Post 01 &amp; launch.jpg')}${entry('1bbbbbbbbbbb', 'Archive', true)}</body></html>`;
  assert.deepEqual(parseFolderView(html), [{ id: '1aaaaaaaaaaa', name: 'Post 01 & launch.jpg', folder: false }, { id: '1bbbbbbbbbbb', name: 'Archive', folder: true }]);
});

test('listDrive: pictures only, nested sub-folders (Month/Week/…) with their path, thumbnails through Drive', async () => {
  const pages = {
    root: entry('1img00000001', 'a.jpg') + entry('1doc00000001', 'brief.pdf') + entry('1sub00000001', 'Tháng 9', true) + entry('1noext000001', 'Ảnh không đuôi'),
    '1sub00000001': entry('1img00000002', 'b.PNG') + entry('1sub00000002', 'deeper', true),
    '1sub00000002': entry('1img00000003', 'c.jpg') + entry('1sub00000003', 'W2', true),
    '1sub00000003': entry('1img00000004', 'W2-Fri-1.png') + entry('1sub00000004', 'x', true),
    '1sub00000004': entry('1sub00000005', 'y', true),
    '1sub00000005': entry('1sub00000006', 'z', true),
    '1sub00000006': entry('1img00000009', 'too-deep.png'),
  };
  const get = async (u) => pages[new URL(u).searchParams.get('id') === '1rootfolder01' ? 'root' : new URL(u).searchParams.get('id')] || '';
  const files = await listDrive('https://drive.google.com/drive/folders/1rootfolder01', get);
  assert.deepEqual(files.map((f) => f.id).sort(), ['1img00000001', '1img00000002', '1img00000003', '1img00000004', '1noext000001']);
  assert.equal(files.find((f) => f.id === '1img00000004').path, 'Tháng 9/deeper/W2', 'folder path kept');
  assert.equal(files.find((f) => f.id === '1img00000001').path, '');
  assert.ok(!files.some((f) => f.id === '1img00000009'), 'stops 4 levels down');
  assert.ok(!files.some((f) => f.id === '1doc00000001'), 'documents skipped');
  assert.ok(files.every((f) => f.thumb.startsWith('https://drive.google.com/thumbnail?id=')));
  await assert.rejects(listDrive('https://drive.google.com/drive/folders/1privatefold', async () => '<html>Sign in</html>'), /Bất kỳ ai/);
  assert.deepEqual((await listDrive('https://drive.google.com/file/d/1single000001/view', get)).map((f) => f.id), ['1single000001']);
});
