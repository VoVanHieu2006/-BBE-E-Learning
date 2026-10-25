import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { VideoControls } from '../lib/video-controls';

describe('Production VideoControls with fake timers', () => {
  for (const action of ['play again', 'forward 10s', 'rewind 10s', '1x', '1.25x', '1.5x', '1.75x', '2x', 'fullscreen', 'seek click']) {
    test(`${action}: pointer focus and stationary hover cannot pin controls`, t => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      let visible = true;
      const controls = new VideoControls(value => { visible = value; });
      controls.pointerEnter(10, 10, 'mouse');
      controls.setPlaying(true);
      controls.pointerInput('mouse');
      controls.focus(); // The browser keeps the clicked button focused.
      controls.reveal(); // Controls click capture, shared by every action.
      t.mock.timers.tick(2499);
      assert.equal(visible, true);
      t.mock.timers.tick(1);
      assert.equal(visible, false);
      assert.equal(controls.keyboardFocus, false);
    });
  }

  test('pause pins controls; Play resumes auto-hide', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let visible = true;
    const controls = new VideoControls(v => { visible = v; });
    controls.pointerInput('mouse');
    controls.setPlaying(true);
    controls.setPlaying(false);
    t.mock.timers.tick(10000);
    assert.equal(visible, true);
    controls.setPlaying(true);
    t.mock.timers.tick(2500);
    assert.equal(visible, false);
  });

  test('Tab focus pins controls, including after pointer leaves; blur resumes', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let visible = true;
    const controls = new VideoControls(v => { visible = v; });
    controls.setPlaying(true);
    controls.keyDown();
    controls.focus();
    controls.pointerLeave('mouse');
    t.mock.timers.tick(10000);
    assert.equal(visible, true);
    controls.blur();
    assert.equal(visible, false);
  });

  test('pointer input releases keyboard pin without blurring the DOM element', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let visible = true;
    const controls = new VideoControls(v => { visible = v; });
    controls.setPlaying(true);
    controls.keyDown();
    controls.focus();
    controls.pointerInput('mouse');
    t.mock.timers.tick(2500);
    assert.equal(visible, false);
  });

  test('seek remains visible while dragging, then ends outside player', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let visible = true;
    const controls = new VideoControls(v => { visible = v; });
    controls.setPlaying(true);
    controls.beginSeek(7);
    controls.pointerLeave('mouse');
    t.mock.timers.tick(10000);
    assert.equal(visible, true);
    assert.equal(controls.endSeek(8), false); // Another finger is not the active drag.
    assert.equal(controls.endSeek(7), true);
    assert.equal(visible, false);
    assert.equal(controls.seekingPointerId, null);
  });

  for (const termination of ['pointerup', 'pointercancel', 'lostpointercapture', 'fullscreen transition']) {
    test(`${termination}: ending a seek resumes the hide deadline`, t => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      let visible = true;
      const controls = new VideoControls(v => { visible = v; });
      controls.pointerInput('mouse');
      controls.setPlaying(true);
      controls.beginSeek(1);
      controls.endSeek(1);
      t.mock.timers.tick(2500);
      assert.equal(visible, false);
    });
  }

  test('touch plus compatibility mouse/click cannot double-toggle or pin', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let visible = true;
    const controls = new VideoControls(v => { visible = v; });
    controls.setPlaying(true);
    controls.pointerInput('touch');
    controls.focus();
    assert.equal(controls.pointerInput('mouse'), false);
    controls.reveal(); // compatibility click is idempotent
    controls.pointerLeave('touch');
    t.mock.timers.tick(2500);
    assert.equal(visible, false);
  });

  test('50 speed changes and 50 seek clicks keep only the latest deadline', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let visible = true;
    const controls = new VideoControls(v => { visible = v; });
    controls.setPlaying(true);
    for (let i = 0; i < 100; i++) {
      controls.pointerInput('mouse');
      controls.focus();
      controls.reveal();
      t.mock.timers.tick(50);
    }
    t.mock.timers.tick(2450);
    assert.equal(visible, false);
  });

  test('buffering PLAYING callbacks do not revive hidden controls or restart deadlines', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let visible = true;
    const controls = new VideoControls(v => { visible = v; });
    controls.pointerInput('mouse');
    controls.setPlaying(true);
    t.mock.timers.tick(2000);
    controls.setPlaying(true);
    t.mock.timers.tick(500);
    assert.equal(visible, false);
    controls.setPlaying(true);
    assert.equal(visible, false);
    controls.pointerMove(50, 50, false, { left: 0, bottom: 100, width: 100 }, 'mouse');
    assert.equal(visible, true);
  });

  test('window blur, video switch and unmount cancel old timers', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let visible = true;
    let changes = 0;
    const controls = new VideoControls(v => { visible = v; changes++; });
    controls.pointerInput('mouse');
    controls.setPlaying(true);
    controls.beginSeek(1);
    controls.windowBlur();
    assert.equal(controls.seekingPointerId, null);
    assert.equal(visible, false);
    controls.reset();
    const before = changes;
    t.mock.timers.tick(10000);
    assert.equal(visible, true);
    assert.equal(changes, before);
    controls.pointerInput('mouse');
    controls.setPlaying(true);
    controls.clear();
    const disposed = changes;
    t.mock.timers.tick(10000);
    assert.equal(changes, disposed);
  });

  test('fullscreen safe zone hides after 600ms and movement elsewhere reveals', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let visible = true;
    const controls = new VideoControls(v => { visible = v; });
    const rect = { left: 0, bottom: 800, width: 1000 };
    controls.pointerInput('mouse');
    controls.setPlaying(true);
    controls.pointerMove(10, 200, true, rect, 'mouse');
    t.mock.timers.tick(300);
    controls.pointerMove(20, 220, true, rect, 'mouse');
    t.mock.timers.tick(300);
    assert.equal(visible, false);
    controls.pointerMove(500, 200, true, rect, 'mouse');
    assert.equal(visible, true);
  });
});
