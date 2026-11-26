const tools = [...document.querySelectorAll("[data-tool]")];
const connections = [];
const stage = document.querySelector("#boardStage");
const wireLayer = document.querySelector("#wireLayer");
const liveMessage = document.querySelector("#liveMessage");
const runButton = document.querySelector("#runButton");
const levelButton = document.querySelector("#levelButton");
const stepMarker = document.querySelector("#stepMarker");
const stepTitle = document.querySelector("#stepTitle");
const stepInstruction = document.querySelector("#stepInstruction");
const stepHint = document.querySelector("#stepHint");
const boardScroll = document.querySelector(".board-scroll");
const cameraPill = document.querySelector("#cameraPill");

let selectedTool = "red-wire";
let firstNode = null;
let level = "HIGH";
let hasRun = false;
let isLit = false;
let messageTimer;

// Camera / Pan state
let isPanning = false;
let hasMovedCamera = false;
let startX = 0;
let startY = 0;
let scrollStartX = 0;
let scrollStartY = 0;

const toolNames = {
  "red-wire": "jumper rojo",
  "black-wire": "jumper negro",
  resistor: "resistencia de 220 Ω",
  led: "LED rojo",
};

const steps = [
  { tool: "red-wire", title: "Conecta la salida", prompt: "El jumper rojo ya está elegido. Conecta D13 con cualquier orificio de la fila 5." },
  { tool: "resistor", title: "Cuida el LED", prompt: "Ahora usa la resistencia de 220 Ω. Une la fila 5 con la fila 8." },
  { tool: "led", title: "Orienta el LED", prompt: "Pon la pata larga del LED en la fila 8 y la corta en la fila 10." },
  { tool: "black-wire", title: "Cierra el camino", prompt: "Con el jumper negro, une la fila 10 con GND (Tierra)." },
];

function showMessage(text, type = "") {
  liveMessage.textContent = text;
  liveMessage.className = `live-message is-visible${type ? ` is-${type}` : ""}`;
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => liveMessage.classList.remove("is-visible"), 4200);
}

function connectionMatchesStep(conn, stepIndex) {
  const a = conn.from;
  const b = conn.to;

  // Paso 0: Jumper rojo de D13 a Fila 5
  if (stepIndex === 0) {
    if (conn.tool !== "red-wire") return false;
    return (a.isD13 && b.row === "5") || (b.isD13 && a.row === "5");
  }

  // Paso 1: Resistencia entre Fila 5 y Fila 8
  if (stepIndex === 1) {
    if (conn.tool !== "resistor") return false;
    return (a.row === "5" && b.row === "8") || (b.row === "5" && a.row === "8");
  }

  // Paso 2: LED entre Fila 8 (ánodo/+) y Fila 10 (cátodo/-)
  if (stepIndex === 2) {
    if (conn.tool !== "led") return false;
    return a.row === "8" && b.row === "10";
  }

  // Paso 3: Jumper negro de Fila 10 a GND
  if (stepIndex === 3) {
    if (conn.tool !== "black-wire") return false;
    return (a.row === "10" && b.isGND) || (b.row === "10" && a.isGND);
  }

  return false;
}

function completeSteps() {
  return [0, 1, 2, 3].map((stepIdx) => connections.some((conn) => connectionMatchesStep(conn, stepIdx)));
}

function nextStepIndex() {
  return completeSteps().findIndex((complete) => !complete);
}

function getPoint(element) {
  if (!element || !document.body.contains(element)) return null;
  const rect = element.getBoundingClientRect();
  const stageRect = stage.getBoundingClientRect();
  return {
    x: ((rect.left + rect.width / 2 - stageRect.left) / stageRect.width) * 1000,
    y: ((rect.top + rect.height / 2 - stageRect.top) / stageRect.height) * 520,
  };
}

function svgElement(name, attrs = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
}

function appendWire(connection, start, end) {
  const bend = connection.tool === "black-wire" ? 42 : -42;
  const pathData = `M ${start.x} ${start.y} C ${start.x + bend} ${start.y}, ${end.x + bend} ${end.y}, ${end.x} ${end.y}`;
  const shadow = svgElement("path", { d: pathData, class: "wire-shadow" });
  const wire = svgElement("path", { d: pathData, class: `wire-path ${connection.tool === "red-wire" ? "red" : "black"}${isLit ? " is-powered" : ""}` });
  const shine = svgElement("path", { d: pathData, class: "wire-shine" });
  wireLayer.append(shadow, wire, shine);
  [start, end].forEach((point) => {
    wireLayer.append(svgElement("circle", { cx: point.x, cy: point.y, r: 6, class: "wire-terminal" }));
  });
}

function appendResistor(start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  const middleX = (start.x + end.x) / 2;
  const middleY = (start.y + end.y) / 2;
  const group = svgElement("g", { transform: `translate(${middleX} ${middleY}) rotate(${angle})` });
  group.append(svgElement("path", { d: `M ${-distance / 2} 0 H -18 M 18 0 H ${distance / 2}`, class: "component-lead" }));
  group.append(svgElement("rect", { x: -19, y: -8, width: 38, height: 16, rx: 8, class: "resistor-body" }));
  [[-11, "#75412f"], [-4, "#d36a40"], [4, "#6e3f36"], [12, "#dfb33f"]].forEach(([x, color]) => {
    group.append(svgElement("rect", { x, y: -7, width: 3, height: 14, rx: 1, fill: color, class: "resistor-band" }));
  });
  group.append(svgElement("path", { d: "M -14 -5 Q 0 -10 14 -5", class: "resistor-shine" }));
  wireLayer.append(group);
  const label = svgElement("text", { x: middleX, y: middleY - 13, "text-anchor": "middle", class: "component-label" });
  label.textContent = "220 Ω";
  wireLayer.append(label);
}

function appendLed(connection, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  const middleX = (start.x + end.x) / 2;
  const middleY = (start.y + end.y) / 2;
  const group = svgElement("g", { transform: `translate(${middleX} ${middleY}) rotate(${angle})` });
  group.append(svgElement("path", { d: `M ${-distance / 2} 0 H -11 M 11 0 H ${distance / 2}`, class: "component-lead" }));
  group.append(svgElement("circle", { cx: 0, cy: 0, r: 11, class: `led-bulb${isLit ? " is-lit" : ""}` }));
  group.append(svgElement("path", { d: "M -6 -5 Q -2 -9 3 -6", class: "led-highlight" }));
  const plus = svgElement("text", { x: -distance / 2 + 2, y: -7, "text-anchor": "middle", class: "polarity-mark" });
  plus.textContent = "+";
  group.append(plus);
  wireLayer.append(group);
}

function renderConnections() {
  wireLayer.replaceChildren();
  connections.forEach((connection) => {
    const start = getPoint(connection.fromElement);
    const end = getPoint(connection.toElement);
    if (!start || !end) return;
    if (connection.tool === "red-wire" || connection.tool === "black-wire") appendWire(connection, start, end);
    if (connection.tool === "resistor") appendResistor(start, end);
    if (connection.tool === "led") appendLed(connection, start, end);
  });
}

function renderConnectionList() {
  const list = document.querySelector("#connectionList");
  list.replaceChildren();
  if (!connections.length) {
    const empty = document.createElement("span");
    empty.className = "empty-connections";
    empty.textContent = "Aquí verás las piezas que conectes.";
    list.append(empty);
    return;
  }
  connections.forEach((connection, index) => {
    const chip = document.createElement("span");
    const color = connection.tool === "red-wire" ? "red" : connection.tool === "black-wire" ? "black" : "part";
    chip.className = `connection-chip ${color}`;
    const text = document.createElement("span");
    text.textContent = `${toolNames[connection.tool]} · ${connection.from.name} a ${connection.to.name}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Quitar";
    remove.setAttribute("aria-label", `Quitar ${toolNames[connection.tool]} de ${connection.from.name} a ${connection.to.name}`);
    remove.addEventListener("click", () => {
      connections.splice(index, 1);
      hasRun = false;
      isLit = false;
      stage.classList.remove("is-lit");
      document.querySelector("#boardLed")?.classList.remove("is-on");
      renderConnections();
      renderConnectionList();
      updateLesson();
      updatePartStatuses();
      updateGuidance();
      showMessage("Pieza retirada.");
    });
    chip.append(text, remove);
    list.append(chip);
  });
}

function updateLesson() {
  const complete = completeSteps();
  const done = complete.filter(Boolean).length;
  const next = nextStepIndex();
  document.querySelectorAll("[data-step]").forEach((item) => {
    const index = Number(item.dataset.step);
    item.classList.toggle("is-done", complete[index]);
    item.classList.toggle("is-current", next >= 0 && index === next);
  });
  document.querySelector("#progressText").textContent = `${done} de 4`;
  document.querySelector("#progressFill").style.width = `${done * 25}%`;
  document.querySelector("#connectionCount").textContent = `${connections.length} ${connections.length === 1 ? "pieza colocada" : "piezas colocadas"}`;
}

function updatePartStatuses() {
  tools.forEach((button) => {
    const name = button.dataset.tool;
    const complete = connections.some((connection) => connection.tool === name);
    button.classList.toggle("selected", name === selectedTool);
    button.setAttribute("aria-pressed", String(name === selectedTool));
    const status = button.querySelector(".part-status");
    if (status) status.textContent = name === selectedTool ? "Elegida" : complete ? "Colocada" : "Lista";
  });
}

function updateTargets() {
  const next = nextStepIndex();
  const step = next >= 0 ? steps[next] : null;

  const beaconD13 = document.querySelector("#beaconD13");
  const beaconGND = document.querySelector("#beaconGND");
  const beaconR5 = document.querySelector("#beaconR5");
  const beaconR8 = document.querySelector("#beaconR8");
  const beaconR10 = document.querySelector("#beaconR10");

  const neededStepNodes = [];
  if (step) {
    if (next === 0) neededStepNodes.push("D13", "r5");
    if (next === 1) neededStepNodes.push("r5", "r8");
    if (next === 2) neededStepNodes.push("r8", "r10");
    if (next === 3) neededStepNodes.push("r10", "GND");
  }

  if (beaconD13) beaconD13.classList.toggle("is-visible", neededStepNodes.includes("D13"));
  if (beaconGND) beaconGND.classList.toggle("is-visible", neededStepNodes.includes("GND"));
  if (beaconR5) beaconR5.classList.toggle("is-visible", neededStepNodes.includes("r5"));
  if (beaconR8) beaconR8.classList.toggle("is-visible", neededStepNodes.includes("r8"));
  if (beaconR10) beaconR10.classList.toggle("is-visible", neededStepNodes.includes("r10"));

  document.querySelectorAll(".bb-hole-group").forEach((group) => {
    const row = group.dataset.row;
    const isTargetRow = (row === "5" && neededStepNodes.includes("r5")) ||
                        (row === "8" && neededStepNodes.includes("r8")) ||
                        (row === "10" && neededStepNodes.includes("r10"));
    group.classList.toggle("is-active-step", Boolean(isTargetRow));
  });

  // Pin highlights
  document.querySelectorAll(".arduino-pin-socket").forEach((node) => {
    const pin = node.dataset.pin;
    const isTarget = (pin === "13" && neededStepNodes.includes("D13")) ||
                     (pin && pin.startsWith("GND") && neededStepNodes.includes("GND"));
    node.classList.toggle("is-target", Boolean(isTarget));
  });
}

function updateGuidance() {
  const next = nextStepIndex();
  if (next < 0) {
    stepMarker.textContent = "4 PASOS COMPLETADOS";
    stepTitle.textContent = "Tu circuito está listo";
    stepInstruction.textContent = "Pulsa Probar circuito para enviar la señal y encender el LED.";
    stepHint.textContent = "La corriente recorrerá los cables";
    updateTargets();
    return;
  }
  const step = steps[next];
  stepMarker.textContent = `PASO ${next + 1} DE 4`;
  stepTitle.textContent = step.title;
  stepInstruction.textContent = firstNode
    ? `¡Bien! Ahora toca el segundo orificio para conectar la pieza.`
    : selectedTool === step.tool
      ? step.prompt
      : `Para este paso usa el ${toolNames[step.tool]}. ${step.prompt}`;
  stepHint.textContent = firstNode ? "Toca el segundo punto" : "Los puntos iluminados muestran el circuito principal";
  updateTargets();
}

function selectTool(name, announce = true) {
  selectedTool = name;
  if (firstNode) {
    firstNode.element.classList.remove("is-selected");
    firstNode = null;
  }
  updatePartStatuses();
  updateGuidance();
  if (announce) showMessage(`Elegiste ${toolNames[name]}. Toca el primer orificio donde quieras conectarlo.`);
}

function getNodeInfo(el) {
  if (!el) return null;

  // 1. Arduino Pin
  if (el.dataset.pin) {
    const pin = el.dataset.pin;
    const isD13 = pin === "13" || pin === "D13";
    const isGND = pin.startsWith("GND");
    let displayName = `el pin ${pin}`;
    if (isD13) displayName = "el pin D13 (Salida)";
    if (isGND) displayName = "el pin GND (Tierra)";
    return {
      type: "arduino",
      pin,
      isD13,
      isGND,
      row: null,
      name: displayName,
      element: el,
    };
  }

  // 2. Breadboard Terminal Hole
  if (el.dataset.hole) {
    const row = el.dataset.row;
    const col = (el.dataset.col || "").toUpperCase();
    return {
      type: "breadboard-terminal",
      row,
      col,
      isD13: false,
      isGND: false,
      name: `la fila ${row} (${col})`,
      element: el,
    };
  }

  // 3. Breadboard Rail Hole
  if (el.dataset.railHole) {
    const rail = el.dataset.rail || "";
    const isPos = rail.includes("pos") || el.dataset.railHole.includes("pos");
    return {
      type: "breadboard-rail",
      rail: isPos ? "+" : "−",
      isD13: false,
      isGND: false,
      row: null,
      name: `el riel ${isPos ? "positivo (+)" : "negativo (−)"}`,
      element: el,
    };
  }

  // 4. Generic data-node
  if (el.dataset.node) {
    const n = el.dataset.node;
    const isD13 = n === "D13";
    const isGND = n === "GND";
    const row = n.startsWith("r") ? n.slice(1) : null;
    return {
      type: "generic",
      name: n,
      isD13,
      isGND,
      row,
      element: el,
    };
  }

  return null;
}

function addConnection(nodeA, nodeB) {
  if (nodeA.element === nodeB.element) {
    showMessage("Toca dos puntos distintos para conectar la pieza.", "error");
    return;
  }

  const isDuplicate = connections.some(
    (c) => (c.fromElement === nodeA.element && c.toElement === nodeB.element) ||
           (c.fromElement === nodeB.element && c.toElement === nodeA.element)
  );
  if (isDuplicate) {
    showMessage("Ya hay una pieza conectada entre esos dos puntos exactos.", "error");
    return;
  }

  const newConnection = {
    tool: selectedTool,
    from: nodeA,
    to: nodeB,
    fromElement: nodeA.element,
    toElement: nodeB.element,
  };

  connections.push(newConnection);
  hasRun = false;
  isLit = false;
  stage.classList.remove("is-lit");
  document.querySelector("#boardLed")?.classList.remove("is-on");

  renderConnections();
  renderConnectionList();
  updateLesson();
  updatePartStatuses();

  const completed = completeSteps();
  const next = nextStepIndex();
  const justCompletedStep = [0, 1, 2, 3].find((stepIdx) => completed[stepIdx] && connectionMatchesStep(newConnection, stepIdx));

  if (justCompletedStep !== undefined) {
    if (next >= 0) {
      selectTool(steps[next].tool, false);
      showMessage(`¡Paso ${justCompletedStep + 1} listo! Siguiente: ${steps[next].title.toLowerCase()}.`, "success");
    } else {
      updateGuidance();
      showMessage("¡Excelente! Ya conectaste los cuatro tramos del circuito. Pulsa Probar circuito.", "success");
    }
  } else {
    updateGuidance();
    showMessage(`Conectaste ${toolNames[selectedTool]} entre ${nodeA.name} y ${nodeB.name}.`);
  }
}

function handleNodeClick(el) {
  if (hasMovedCamera) return;

  const nodeInfo = getNodeInfo(el);
  if (!nodeInfo) return;

  if (!firstNode) {
    firstNode = nodeInfo;
    nodeInfo.element.classList.add("is-selected");
    updateGuidance();
    showMessage(`Elegiste ${nodeInfo.name}. Ahora toca cualquier otro orificio o pin donde quieras conectarlo.`);
    return;
  }

  const fromNode = firstNode;
  firstNode.element.classList.remove("is-selected");
  firstNode = null;
  addConnection(fromNode, nodeInfo);
}

// Attach click listeners to all Arduino pins and breadboard holes
document.querySelectorAll(".arduino-pin-socket, .bb-hole, [data-node]").forEach((button) => {
  button.addEventListener("click", () => handleNodeClick(button));
});

// Tinkercad signature electrical continuity highlight on hover
document.querySelectorAll(".bb-hole").forEach((hole) => {
  hole.addEventListener("mouseenter", () => {
    if (isPanning) return;
    const row = hole.dataset.row;
    const group = hole.dataset.group;
    const rail = hole.dataset.rail;

    if (row && group) {
      document.querySelectorAll(`.bb-hole[data-row="${row}"][data-group="${group}"]`).forEach((h) => {
        h.classList.add("is-connected-hover");
      });
    } else if (rail) {
      document.querySelectorAll(`.bb-hole[data-rail="${rail}"]`).forEach((h) => {
        h.classList.add("is-connected-hover");
      });
    }
  });

  hole.addEventListener("mouseleave", () => {
    document.querySelectorAll(".is-connected-hover").forEach((h) => h.classList.remove("is-connected-hover"));
  });
});

/* ========================================================
   CAMERA CONTROLLER: CLICK SOSTENIDO / DRAG & CENTRADO
   ======================================================== */
function centerStage(smooth = true) {
  const maxScroll = Math.max(0, stage.offsetWidth - boardScroll.clientWidth);
  const targetLeft = maxScroll / 2;
  boardScroll.scrollTo({
    left: targetLeft,
    behavior: smooth ? "smooth" : "auto",
  });
}

// Mouse Drag / Click sostenido
boardScroll.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;

  startX = e.clientX;
  startY = e.clientY;
  scrollStartX = boardScroll.scrollLeft;
  scrollStartY = boardScroll.scrollTop;
  hasMovedCamera = false;

  const onButton = e.target.closest("button, .bb-hole, .arduino-pin-socket, [data-node]");
  if (!onButton) {
    isPanning = true;
    boardScroll.classList.add("is-panning");
  }
});

window.addEventListener("mousemove", (e) => {
  if (e.buttons !== 1) {
    if (isPanning) {
      isPanning = false;
      boardScroll.classList.remove("is-panning");
    }
    return;
  }

  const dx = e.clientX - startX;
  const dy = e.clientY - startY;

  if (!isPanning && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
    isPanning = true;
    boardScroll.classList.add("is-panning");
  }

  if (isPanning) {
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      hasMovedCamera = true;
      if (cameraPill) cameraPill.classList.add("is-hidden");
    }
    boardScroll.scrollLeft = scrollStartX - dx;
    boardScroll.scrollTop = scrollStartY - dy;
  }
});

window.addEventListener("mouseup", () => {
  if (isPanning) {
    isPanning = false;
    boardScroll.classList.remove("is-panning");
    setTimeout(() => {
      hasMovedCamera = false;
    }, 60);
  }
});

// Touch support
boardScroll.addEventListener("touchstart", () => {
  hasMovedCamera = false;
}, { passive: true });

boardScroll.addEventListener("touchmove", () => {
  hasMovedCamera = true;
  if (cameraPill) cameraPill.classList.add("is-hidden");
}, { passive: true });

function isCircuitComplete() {
  return completeSteps().every(Boolean);
}

function runCircuit() {
  if (runButton.disabled) return;
  runButton.disabled = true;
  runButton.setAttribute("aria-busy", "true");
  runButton.innerHTML = '<span class="spinner" aria-hidden="true"></span>Probando';
  window.setTimeout(() => {
    runButton.disabled = false;
    runButton.removeAttribute("aria-busy");
    runButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7z"/></svg>Probar circuito';
    hasRun = true;
    if (!isCircuitComplete()) {
      isLit = false;
      stage.classList.remove("is-lit");
      document.querySelector("#boardLed")?.classList.remove("is-on");
      renderConnections();
      const complete = completeSteps();
      const missing = complete.findIndex((value) => !value);
      if (firstNode) {
        firstNode.element.classList.remove("is-selected");
        firstNode = null;
      }
      selectTool(steps[missing].tool, false);
      updateGuidance();
      const message = missing === 2 && complete[1]
        ? "El camino está abierto. Revisa el LED: la pata larga (+) va en la fila 8 y la corta en la fila 10."
        : `El camino está abierto. Falta el paso ${missing + 1}: ${steps[missing].prompt}`;
      showMessage(message, "error");
      return;
    }
    isLit = level === "HIGH";
    stage.classList.toggle("is-lit", isLit);
    document.querySelector("#boardLed")?.classList.toggle("is-on", isLit);
    renderConnections();
    if (isLit) showMessage("¡Lo lograste! La corriente llegó al LED y lo encendió.", "success");
    else showMessage("El circuito está conectado, pero D13 está en LOW. Cámbialo a HIGH para encender el LED.", "error");
  }, 380);
}

runButton.addEventListener("click", runCircuit);
levelButton.addEventListener("click", () => {
  level = level === "HIGH" ? "LOW" : "HIGH";
  levelButton.textContent = level;
  levelButton.setAttribute("aria-label", `Cambiar nivel del pin 13, ahora ${level}`);
  if (hasRun && isCircuitComplete()) {
    isLit = level === "HIGH";
    stage.classList.toggle("is-lit", isLit);
    document.querySelector("#boardLed")?.classList.toggle("is-on", isLit);
    renderConnections();
  }
  showMessage(level === "LOW" ? "D13 está en LOW: la luz se apaga." : "D13 está en HIGH: la señal puede encender el LED.");
});

document.querySelector("#resetButton").addEventListener("click", () => {
  connections.length = 0;
  if (firstNode) {
    firstNode.element.classList.remove("is-selected");
    firstNode = null;
  }
  hasRun = false;
  isLit = false;
  level = "HIGH";
  levelButton.textContent = level;
  levelButton.setAttribute("aria-label", "Cambiar nivel del pin 13, ahora HIGH");
  document.querySelectorAll(".is-selected, .is-connected-hover").forEach((el) => el.classList.remove("is-selected", "is-connected-hover"));
  stage.classList.remove("is-lit");
  document.querySelector("#boardLed")?.classList.remove("is-on");
  renderConnections();
  renderConnectionList();
  updateLesson();
  selectTool("red-wire", false);
  showMessage("Mesa reiniciada. Empieza por el pin D13.");
});

document.querySelector("#hintButton").addEventListener("click", (event) => {
  const button = event.currentTarget;
  const expanded = button.getAttribute("aria-expanded") === "true";
  button.setAttribute("aria-expanded", String(!expanded));
  document.querySelector("#hintText").hidden = expanded;
  button.textContent = expanded ? "Mostrar" : "Ocultar";
});

document.querySelector("#explainButton").addEventListener("click", (event) => {
  const button = event.currentTarget;
  const expanded = button.getAttribute("aria-expanded") === "true";
  button.setAttribute("aria-expanded", String(!expanded));
  document.querySelector("#codeExplanation").hidden = expanded;
  button.textContent = expanded ? "¿Qué significa?" : "Ocultar explicación";
});

document.querySelector("#centerButton").addEventListener("click", () => {
  centerStage(true);
  showMessage("Mesa centrada. Los componentes ya están a la vista.");
});

tools.forEach((button) => button.addEventListener("click", () => selectTool(button.dataset.tool)));
window.addEventListener("resize", () => {
  renderConnections();
});
boardScroll.addEventListener("scroll", renderConnections, { passive: true });

updateLesson();
updatePartStatuses();
updateGuidance();
renderConnections();

// Centrado inicial automático de la mesa al cargar la página
window.addEventListener("load", () => centerStage(false));
setTimeout(() => centerStage(false), 60);
