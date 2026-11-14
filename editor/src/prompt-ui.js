import {
  getEditorPromptProfiles,
  getPromptProfile,
  buildProfilePrompt,
} from "scad-gltf/prompt";

const rawGodotAddonModules = import.meta.glob(
  "../../godot/addons/scad_importer/*.{gd,cfg}",
  { query: "?raw", import: "default", eager: true },
);

export const GODOT_ADDON_FILES = Object.entries(rawGodotAddonModules)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([filePath, content]) => {
    const filename = filePath.split("/").pop();
    return {
      path: `addons/scad_importer/${filename}`,
      lang: filename.endsWith(".gd") ? "gdscript" : "text",
      content,
    };
  });

const rawRustBuildModules = import.meta.glob("../../rust/build.rs", {
  query: "?raw",
  import: "default",
  eager: true,
});

export const RUST_TEMPLATE_FILES = Object.entries(rawRustBuildModules).map(
  ([, content]) => ({
    path: "build.rs",
    lang: "rust",
    content,
  }),
);

const rawUePluginModules = import.meta.glob(
  "../../ue/Plugins/ScadImporter/**/*.{uplugin,cs,cpp,h}",
  { query: "?raw", import: "default", eager: true },
);

export const UE_PLUGIN_FILES = Object.entries(rawUePluginModules)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([filePath, content]) => {
    const relativePath = filePath.replace(/^(\.\.\/)+ue\//, "");
    const lower = filePath.toLowerCase();
    let lang = "text";
    if (lower.endsWith(".cpp") || lower.endsWith(".h")) lang = "cpp";
    else if (lower.endsWith(".cs")) lang = "csharp";
    else if (lower.endsWith(".uplugin")) lang = "json";
    return {
      path: relativePath,
      lang,
      content,
    };
  });

const OPTION_ID_MAP = {
  basic: "opt-pbr-basic",
  autoSmoothAngle: "opt-pbr-autosmooth",
  animation: "opt-anim",
  lights: "opt-lights",
  transmission: "opt-pbr-transmission",
  clearcoat: "opt-pbr-clearcoat",
  sheen: "opt-pbr-sheen",
  emissive: "opt-pbr-emissive",
  specular: "opt-pbr-specular",
  iridescence: "opt-pbr-iridescence",
  unlit: "opt-pbr-unlit",
  bakeColors: "opt-bake-colors",
  bakeNormals: "opt-bake-normals",
  bakeOrm: "opt-bake-orm",
  bakeUvs: "opt-bake-uvs",
  colormap: "opt-pbr-colormap",
};

export const PROMPT_UI_HTML = `
  <div class="scad-prompt-profile-row">
    <label for="opt-prompt-profile">Profile</label>
    <select id="opt-prompt-profile"></select>
  </div>

  <div class="scad-prompt-toggles">
    <label><input type="checkbox" id="opt-pbr-basic" checked /> Basic PBR</label>
    <label><input type="checkbox" id="opt-pbr-autosmooth" checked /> Auto Smooth</label>
    <label><input type="checkbox" id="opt-anim" checked /> Animations</label>
    <label><input type="checkbox" id="opt-lights" /> Lights</label>
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
      <label><input type="checkbox" class="pbr-child" id="opt-pbr-unlit" checked /> Unlit</label>
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
      <label><input type="checkbox" class="bake-child" id="opt-pbr-colormap" /> Colormap</label>
    </div>
  </div>
`;

export function getSelectedPromptProfile(containerElement) {
  return (
    containerElement?.querySelector("#opt-prompt-profile")?.value || "scad"
  );
}

export function setupPromptToggles(
  containerElement,
  storageKey = "scad_prompt_settings",
  uiRefs = {},
) {
  const { helpTextEl = null, descEl = null } = uiRefs;
  const profileSelect = containerElement.querySelector("#opt-prompt-profile");
  const editorProfiles = getEditorPromptProfiles();

  if (profileSelect) {
    profileSelect.innerHTML = "";
    for (const profile of editorProfiles) {
      const opt = document.createElement("option");
      opt.value = profile.id;
      opt.textContent = profile.label;
      profileSelect.appendChild(opt);
    }
  }

  // Load persisted settings (migrating legacy flat checkbox state to profiles.scad)
  let store = { activeProfile: "scad", profiles: {} };
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.profiles === "object") {
        store = {
          activeProfile: parsed.activeProfile || "scad",
          profiles: parsed.profiles || {},
        };
      } else if (parsed && typeof parsed === "object") {
        store = { activeProfile: "scad", profiles: { scad: parsed } };
      }
    }
  } catch (e) {
    console.warn("Could not load SCAD prompt settings", e);
  }

  const saveSettings = () => {
    const profileId = getSelectedPromptProfile(containerElement);
    const state = {};
    containerElement
      .querySelectorAll('input[type="checkbox"]')
      .forEach((cb) => {
        if (cb.id) state[cb.id] = cb.checked;
      });
    store.activeProfile = profileId;
    store.profiles[profileId] = state;
    localStorage.setItem(storageKey, JSON.stringify(store));
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

  const applyProfileState = (profileId) => {
    const profile = getPromptProfile(profileId);
    const savedForProfile = store.profiles[profileId] || {};

    // Apply profile defaults first, then user overrides for that profile
    for (const [optKey, cbId] of Object.entries(OPTION_ID_MAP)) {
      const cb = containerElement.querySelector(`#${cbId}`);
      if (!cb) continue;
      if (savedForProfile[cbId] !== undefined) {
        cb.checked = savedForProfile[cbId];
      } else if (profile.defaultPromptOptions?.[optKey] !== undefined) {
        cb.checked = profile.defaultPromptOptions[optKey];
      }
    }

    updatePbrState();
    updateBakeState();

    if (helpTextEl && profile.helpText) {
      helpTextEl.textContent = profile.helpText;
    }
    if (descEl && profile.descriptionPlaceholder) {
      descEl.placeholder = profile.descriptionPlaceholder;
    }
  };

  if (profileSelect) {
    const validIds = new Set(editorProfiles.map((p) => p.id));
    const initialProfile = validIds.has(store.activeProfile)
      ? store.activeProfile
      : "scad";
    profileSelect.value = initialProfile;
    applyProfileState(initialProfile);

    profileSelect.addEventListener("change", (e) => {
      applyProfileState(e.target.value);
      saveSettings();
    });
  } else {
    applyProfileState("scad");
  }

  containerElement.addEventListener("change", (e) => {
    if (e.target.type === "checkbox") saveSettings();
  });
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
    unlit: containerElement.querySelector("#opt-pbr-unlit")?.checked ?? true,
    autoSmoothAngle:
      containerElement.querySelector("#opt-pbr-autosmooth")?.checked ?? true,
    bakeColors:
      containerElement.querySelector("#opt-bake-colors")?.checked ?? false,
    bakeNormals:
      containerElement.querySelector("#opt-bake-normals")?.checked ?? false,
    bakeOrm: containerElement.querySelector("#opt-bake-orm")?.checked ?? false,
    bakeUvs: containerElement.querySelector("#opt-bake-uvs")?.checked ?? false,
    colormap:
      containerElement.querySelector("#opt-pbr-colormap")?.checked ?? false,
    animation: containerElement.querySelector("#opt-anim")?.checked ?? true,
    lights: containerElement.querySelector("#opt-lights")?.checked ?? false,
  };
}

function getTemplateFilesForProfile(profileId) {
  if (profileId === "godot") return GODOT_ADDON_FILES;
  if (profileId === "bevy" || profileId === "wgpu") return RUST_TEMPLATE_FILES;
  if (profileId === "ue") return UE_PLUGIN_FILES;
  return [];
}

export function buildPromptFromUI(
  containerElement,
  description,
  { referenceFiles = [], templateFiles = null } = {},
) {
  const profileId = getSelectedPromptProfile(containerElement);
  const promptOptions = getPromptOptions(containerElement);
  const resolvedTemplates =
    templateFiles ?? getTemplateFilesForProfile(profileId);

  return buildProfilePrompt(profileId, {
    task: description,
    promptOptions,
    templateFiles: resolvedTemplates,
    referenceFiles,
  });
}
