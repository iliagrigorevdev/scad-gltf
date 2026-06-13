export const PROMPT_UI_HTML = `
  <div class="scad-prompt-toggles">
    <label><input type="checkbox" id="opt-pbr-basic" checked /> Basic PBR</label>
    <label><input type="checkbox" id="opt-pbr-autosmooth" checked /> Auto Smooth</label>
    <label><input type="checkbox" id="opt-anim" checked /> Animations</label>
  </div>

  <div class="scad-prompt-group">
    <div class="scad-prompt-group-header">
      <span>Extended PBR</span>
      <label><input type="checkbox" id="opt-pbr-all" checked /> Enable All</label>
    </div>
    <div class="scad-prompt-toggles nested" id="pbr-children">
      <label><input type="checkbox" class="pbr-child" id="opt-pbr-transmission" checked /> Transmission</label>
      <label><input type="checkbox" class="pbr-child" id="opt-pbr-clearcoat" checked /> Clearcoat</label>
      <label><input type="checkbox" class="pbr-child" id="opt-pbr-sheen" checked /> Sheen</label>
      <label><input type="checkbox" class="pbr-child" id="opt-pbr-emissive" checked /> Emissive</label>
      <label><input type="checkbox" class="pbr-child" id="opt-pbr-specular" checked /> Specular</label>
      <label><input type="checkbox" class="pbr-child" id="opt-pbr-iridescence" checked /> Iridescence</label>
    </div>
  </div>

  <div class="scad-prompt-group">
    <div class="scad-prompt-group-header">
      <span>Baking</span>
      <label><input type="checkbox" id="opt-bake-all" /> Enable All</label>
    </div>
    <div class="scad-prompt-toggles nested" id="bake-children">
      <label><input type="checkbox" class="bake-child" id="opt-bake-colors" /> Bake Colors</label>
      <label><input type="checkbox" class="bake-child" id="opt-bake-normals" /> Bake Normals</label>
      <label><input type="checkbox" class="bake-child" id="opt-bake-orm" /> Bake ORM</label>
      <label><input type="checkbox" class="bake-child" id="opt-bake-uvs" /> Bake UVs/Tangents</label>
    </div>
  </div>
`;

export function setupPromptToggles(
  containerElement,
  storageKey = "scad_prompt_settings",
) {
  const saveSettings = () => {
    const state = {};
    containerElement
      .querySelectorAll('input[type="checkbox"]')
      .forEach((cb) => {
        if (cb.id) state[cb.id] = cb.checked;
      });
    localStorage.setItem(storageKey, JSON.stringify(state));
  };

  const setupGroup = (allBtnId, childSelector) => {
    const allBtn = containerElement.querySelector(allBtnId);
    const children = containerElement.querySelectorAll(childSelector);

    const updateState = () => {
      if (!allBtn || children.length === 0) return;
      const allChecked = Array.from(children).every((c) => c.checked);
      const someChecked = Array.from(children).some((c) => c.checked);
      allBtn.checked = allChecked;
      allBtn.indeterminate = someChecked && !allChecked;
    };

    if (allBtn && children.length > 0) {
      allBtn.addEventListener("change", (e) => {
        const checked = e.target.checked;
        children.forEach((cb) => (cb.checked = checked));
        saveSettings();
      });

      children.forEach((cb) => {
        cb.addEventListener("change", () => {
          updateState();
          saveSettings();
        });
      });
    }

    return updateState;
  };

  const updatePbrState = setupGroup("#opt-pbr-all", ".pbr-child");
  const updateBakeState = setupGroup("#opt-bake-all", ".bake-child");

  // Load from Local Storage
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      const parsed = JSON.parse(saved);
      containerElement
        .querySelectorAll('input[type="checkbox"]')
        .forEach((cb) => {
          if (cb.id && parsed[cb.id] !== undefined) {
            cb.checked = parsed[cb.id];
          }
        });
    }
  } catch (e) {
    console.warn("Could not load SCAD prompt settings", e);
  }

  // Listen to generic changes (Basic PBR, Animation, etc)
  containerElement.addEventListener("change", (e) => {
    if (e.target.type === "checkbox") saveSettings();
  });

  // Init visual state
  updatePbrState();
  updateBakeState();
}

export function getPromptOptions(containerElement) {
  return {
    basic: containerElement.querySelector("#opt-pbr-basic")?.checked ?? true,
    transmission:
      containerElement.querySelector("#opt-pbr-transmission")?.checked ?? true,
    clearcoat:
      containerElement.querySelector("#opt-pbr-clearcoat")?.checked ?? true,
    sheen: containerElement.querySelector("#opt-pbr-sheen")?.checked ?? true,
    emissive:
      containerElement.querySelector("#opt-pbr-emissive")?.checked ?? true,
    specular:
      containerElement.querySelector("#opt-pbr-specular")?.checked ?? true,
    iridescence:
      containerElement.querySelector("#opt-pbr-iridescence")?.checked ?? true,
    autoSmoothAngle:
      containerElement.querySelector("#opt-pbr-autosmooth")?.checked ?? true,
    bakeColors:
      containerElement.querySelector("#opt-bake-colors")?.checked ?? false,
    bakeNormals:
      containerElement.querySelector("#opt-bake-normals")?.checked ?? false,
    bakeOrm: containerElement.querySelector("#opt-bake-orm")?.checked ?? false,
    bakeUvs: containerElement.querySelector("#opt-bake-uvs")?.checked ?? false,
    animation: containerElement.querySelector("#opt-anim")?.checked ?? true,
  };
}
