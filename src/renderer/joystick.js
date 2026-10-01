(function (global) {
  'use strict';

  // --- Joystick visual (nipple.js) ---
  const zone = document.getElementById('joystick-zone');
  const manager = nipplejs.create({
    zone: zone,
    mode: 'static',
    position: { left: '50%', top: '50%' },
    color: '#4285f4',
    size: 130,
    restOpacity: 0.65,
    dynamicPage: true
  });

  // Estado do joystick (continuo)
  const joy = { x: 0, y: 0, magnitude: 0, heading: 0, active: false };

  manager.on('move', function (evt, data) {
    if (!data || !data.vector) return;
    joy.active = true;
    // nipplejs: vector.x +direita, vector.y +cima (padrao matematico)
    joy.x = data.vector.x;
    joy.y = data.vector.y;
    joy.magnitude = Math.min(1, data.force || Math.hypot(joy.x, joy.y));
    // Heading cartografico: 0=Norte, 90=Leste (horario)
    // atan2(x, y) com y+=norte, x+=leste da exatamente isso
    joy.heading = ((Math.atan2(joy.x, joy.y) * 180 / Math.PI) + 360) % 360;
  });

  manager.on('end', function () {
    joy.active = false;
    joy.x = 0;
    joy.y = 0;
    joy.magnitude = 0;
    // mantem heading pro marker nao resetar quando parar
  });

  // --- Teclado WASD / setas ---
  const keys = { up: false, down: false, left: false, right: false };

  function keyMap(e) {
    const k = e.key.toLowerCase();
    if (k === 'w' || e.key === 'ArrowUp')    return 'up';
    if (k === 's' || e.key === 'ArrowDown')  return 'down';
    if (k === 'a' || e.key === 'ArrowLeft')  return 'left';
    if (k === 'd' || e.key === 'ArrowRight') return 'right';
    return null;
  }

  window.addEventListener('keydown', function (e) {
    const key = keyMap(e);
    if (key) { keys[key] = true; e.preventDefault(); }
  });
  window.addEventListener('keyup', function (e) {
    const key = keyMap(e);
    if (key) { keys[key] = false; e.preventDefault(); }
  });

  // Perde teclas se a janela perder foco
  window.addEventListener('blur', function () {
    keys.up = keys.down = keys.left = keys.right = false;
  });

  function getKeyboardInput() {
    let x = 0, y = 0;
    if (keys.up)    y += 1;
    if (keys.down)  y -= 1;
    if (keys.right) x += 1;
    if (keys.left)  x -= 1;
    const mag = Math.hypot(x, y);
    if (mag === 0) return null;
    return {
      x: x / mag,
      y: y / mag,
      magnitude: 1,
      heading: ((Math.atan2(x / mag, y / mag) * 180 / Math.PI) + 360) % 360
    };
  }

  // Input unificado: teclado tem prioridade quando pressionado
  function getInput() {
    const kb = getKeyboardInput();
    if (kb) return kb;
    return {
      x: joy.x,
      y: joy.y,
      magnitude: joy.magnitude,
      heading: joy.heading
    };
  }

  global.FakeGPS = global.FakeGPS || {};
  global.FakeGPS.Input = { getInput: getInput };
})(window);
