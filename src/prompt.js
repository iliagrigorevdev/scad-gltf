/**
 * Generates an LLM prompt containing the required syntax rules for PBR, Animations,
 * and Texture Baking in this custom OpenSCAD fork.
 *
 * @param {string} description - The description of the object you want the AI to design.
 * @param {Object} options - Toggles for different prompt blocks
 * @returns {string} The fully formatted LLM prompt.
 */
export function generatePrompt(description, options = {}) {
  if (!description) {
    throw new Error("A description is required to generate a prompt.");
  }

  const opts = {
    basic: options.basic ?? true,
    transmission: options.transmission ?? true,
    clearcoat: options.clearcoat ?? true,
    sheen: options.sheen ?? true,
    emissive: options.emissive ?? true,
    specular: options.specular ?? true,
    iridescence: options.iridescence ?? true,
    unlit: options.unlit ?? true,
    colormap: options.colormap ?? false,
    bakeColors: options.bakeColors ?? false,
    bakeNormals: options.bakeNormals ?? false,
    bakeOrm: options.bakeOrm ?? false,
    bakeUvs: options.bakeUvs ?? false,
    autoSmoothAngle: options.autoSmoothAngle ?? true,
    animation: options.animation ?? true,
    lazyUnion: options.lazyUnion ?? false,
    modelName: options.modelName ?? true,
    lights: options.lights ?? false,
  };

  let prompt = `Generate an OpenSCAD script to design the following: ${description}.`;

  if (opts.modelName) {
    prompt += `\n\nImportant Output Rules:
- You MUST wrap your code in a standard Markdown code block using the \`\`\`openscad language tag.
- Inside the code block, on the first line, include a block comment with a concise filename in snake_case (lowercase and underscores).
- Use this exact format: /* Model Name: your_model_name_here */`;
  }

  let attrs = [];
  if (opts.basic) attrs.push("'roughness'", "'metalness'");
  if (opts.clearcoat) attrs.push("'clearcoat'", "'clearcoatRoughness'");
  if (opts.sheen) attrs.push("'sheen'", "'sheenColor'", "'sheenRoughness'");
  if (opts.transmission)
    attrs.push(
      "'transmission'",
      "'thickness'",
      "'attenuationColor'",
      "'attenuationDistance'",
      "'ior'",
    );
  if (opts.emissive) attrs.push("'emissive'", "'emissiveIntensity'");
  if (opts.specular) attrs.push("'specularColor'", "'specularIntensity'");
  if (opts.iridescence) attrs.push("'iridescence'", "'iridescenceIOR'");
  if (opts.unlit) attrs.push("'unlit'");
  if (opts.colormap) attrs.push("'colormap'");

  if (attrs.length > 0 || opts.autoSmoothAngle) {
    if (attrs.length > 0) {
      prompt += `\n\nPlease utilize extended color attributes, specifically including ${attrs.join(", ")} parameters.`;
    }
    prompt += `\n\nImportant PBR & Shading rules:`;

    if (opts.colormap) {
      prompt += `\n- Passing Functions: OpenSCAD separates function and variable namespaces. You CANNOT pass a function by its name directly (e.g., \`map=my_func\` will fail and evaluate to undef). If you define a custom function, you MUST wrap it in a function literal (lambda) when passing it. Example: \`map=function(x,y,z) my_func(x,y,z)\`.`;
    }

    if (opts.basic) {
      prompt += `\n- Metalness: For solid metallic materials (e.g., gold, steel), use metalness near 1.0. High metalness blocks light transmission. (Default: 0.0)`;
      prompt += `\n- Roughness: Controls surface finish. 0.0 is perfectly smooth/glossy, while 1.0 is completely matte. (Default: 1.0)`;
    }
    if (opts.transmission) {
      prompt += `\n- Transmission: Degree of optical transparency (0.0 to 1.0) for materials like glass or water. Note: When transmission is non-zero, alpha (opacity) should be set to 1.0. (Default: 0.0)`;
      prompt += `\n- Thickness: The thickness of the volume beneath the surface. If 0.0, the material is thin-walled (like a bubble). If > 0, it acts as a solid volume boundary (like a block of glass). (Default: 0.0)`;
      prompt += `\n- Attenuation Color & Distance: Used with transmission and thickness to simulate volume absorption (colored glass or liquids). Distance is how far light travels to reach the attenuationColor. (Defaults: [1.0, 1.0, 1.0] and 0.0)`;
      prompt += `\n- IOR (Index of Refraction): Controls how much light bends when entering a transmissive or clearcoat material. Water is ~1.33, Window Glass ~1.5, Diamond ~2.4. (Default: 1.5)`;
    }
    if (opts.clearcoat) {
      prompt += `\n- Clearcoat: Adds a clear, reflective layer on top of the base material (car paint, varnished wood, or wet surfaces). 1.0 is fully coated. (Default: 0.0)`;
      prompt += `\n- Clearcoat Roughness: Controls the smoothness of the clearcoat layer. (Default: 0.0)`;
    }
    if (opts.sheen) {
      prompt += `\n- Sheen: Simulates backscattering from microfibers, creating a soft velvet-like rim light useful for cloth and fabrics. 1.0 is full intensity. (Default: 0.0)`;
      prompt += `\n- Sheen Color: Sets the RGB tint of the sheen layer (e.g., sheenColor = [1.0, 0.5, 0.5]). (Default: [0.0, 0.0, 0.0])`;
      prompt += `\n- Sheen Roughness: Controls the roughness of the sheen layer. (Default: 0.0)`;
    }
    if (opts.emissive) {
      prompt += `\n- Emissive & Emissive Intensity: Makes the material glow. Emissive is an RGB color vector, intensity is a float multiplier. (Defaults: [0.0, 0.0, 0.0] and 1.0)`;
    }
    if (opts.specular) {
      prompt += `\n- Specular Color & Intensity: Overrides the default specular reflection. (Defaults: [1.0, 1.0, 1.0] and 1.0)`;
    }
    if (opts.iridescence) {
      prompt += `\n- Iridescence & Iridescence IOR: Simulates thin-film interference like soap bubbles, oil spills, or pearlescent surfaces. (Defaults: 0.0 and 1.3)`;
    }
    if (opts.unlit) {
      prompt += `\n- Unlit: Makes the material shadeless (unaffected by lighting), rendering exactly its base color. Accepts true or false. (Default: false)`;
    }
    if (opts.colormap) {
      prompt += `\n- Colormap: Accepts a user-defined function to procedurally generate surface textures. The function MUST take 3 parameters (x, y, z) representing the 3D local coordinates of the surface, and return a color vector [r, g, b, a]. The exporter automatically unwraps the geometry and bakes this function into a 2D base color texture map (default resolution is 256x256, unique atlas per object). To change resolution, wrap the object in a \`bake(resolution=512)\` module. To group multiple objects into a shared atlas, assign them the same index: \`bake(index=1)\`. Example inline: \`colormap=function(x,y,z) [sin(x*10)/2+0.5, cos(y*10)/2+0.5, z/10, 1.0]\`.`;
    }
    if (opts.autoSmoothAngle) {
      prompt += `\n- Auto Smooth Angle: Generates smooth vertex normals for adjoining faces with an angle difference less than this value (in degrees). Use > 0 (e.g., 30 or 45) for curved/smooth surfaces, 0.0 for flat shading. Can be set globally using the special variable \`$asa\` (e.g., \`$asa=30;\`), or overridden per-material via the \`$asa\` parameter INSIDE the color() module. IMPORTANT: \`$asa\` ONLY affects surface shading (normals). It DOES NOT alter the actual geometry or polygon count. You must still use standard variables like \`$fn\` to increase geometric resolution. DO NOT pass \`$asa\` directly to geometry modules like sphere() or cylinder(). (Default: 0.0)`;
    }

    let exampleParams = [];
    if (opts.basic) exampleParams.push("metalness=1.0", "roughness=0.3");
    if (opts.transmission) exampleParams.push("transmission=0.8", "ior=1.5");
    if (opts.clearcoat) exampleParams.push("clearcoat=1.0");
    if (opts.sheen) exampleParams.push("sheen=1.0");
    if (opts.iridescence) exampleParams.push("iridescence=1.0");
    if (opts.unlit) exampleParams.push("unlit=true");
    if (opts.emissive)
      exampleParams.push("emissive=[0.0, 0.5, 1.0]", "emissiveIntensity=2.0");
    if (opts.specular) exampleParams.push("specularIntensity=1.0");
    if (opts.colormap)
      exampleParams.push(
        "colormap=function(x,y,z) [sin(x)/2+0.5, 0.5, 0.5, 1.0]",
      );
    if (opts.autoSmoothAngle) exampleParams.push("$asa=45.0");

    let exampleStr =
      exampleParams.length > 0 ? ", " + exampleParams.join(", ") : "";

    prompt += `\n\nExample Material Usage:\n\`\`\`openscad\n// Syntax: color(c=color_value, alpha=1.0, [named PBR parameters...])\ncolor([0.2, 0.2, 0.2], alpha=1.0${exampleStr})\n  cube([10, 10, 10]);\n\`\`\``;
  }

  if (opts.lazyUnion) {
    prompt += `\n\nImportant Geometry rules:\n- The compiler runs with "lazy-union" enabled. This means top-level objects, module children, and items inside loops ('for') or conditionals ('if') are NOT implicitly boolean-unioned together. They are evaluated and exported as separate discrete meshes.`;
  }

  if (opts.animation) {
    prompt += `\n\nImportant Animation & Skinning rules:
- Wrapping: Use the 'armature(animations=...)' module at the root to wrap all animated components.
- Hierarchies: Use the 'bone(name="BoneName", t=[x,y,z], r=[x,y,z])' module to define hierarchical animated parts.
- Skinning / Soft-Body Deformation: To bind a soft mesh to multiple bones, wrap the geometry in a 'skin(bones=["Bone1", "Bone2"], weights=function(x,y,z) [...])' module.
  * Placement: The 'skin()' module MUST be placed directly inside the 'armature()', OUTSIDE of the 'bone()' hierarchy. You may include multiple 'skin()' modules if your model has several separate soft-body parts.
  * Weight Function: The 'weights' parameter takes a 3-parameter function evaluating the localized 3D coordinates (x,y,z) of each vertex, returning an array of weights corresponding to the 'bones' array. Example: \`function(x,y,z) [1.0 - (z/10), z/10]\`. The exporter automatically normalizes weights and limits to the 4 strongest bones.
  * Geometry: Meshes must have enough vertices to bend smoothly! Always use a sufficiently high '$fn' (e.g., $fn=32) for curved geometries.
- Rigid Attachment (Auto-Unioning): Any child meshes placed directly inside a 'bone()' node are rigidly attached to that bone.
- Camera Animation: You can create an animated glTF camera by naming a bone "Camera" or "camera". You can append numbers or separators to the name (e.g., "Camera1", "Camera_fov60" for Perspective 60 deg FOV, or "Camera_ortho_mag10" for Orthographic, scale 10). Physical parts like "CameraMount" are safely ignored. It will animate just like any other bone! Note: The camera looks forward along the +Y axis, with +Z as its UP direction.
- Animation Data: The 'animations' property is an array of named animation sequences. Each sequence contains an array of tracks defining keyframes for each bone. Format:
  animations = [
    ["AnimationName", [
      ["BoneName", [
        [time_in_seconds, [rot_x, rot_y, rot_z], [trans_x, trans_y, trans_z]], // Translation is optional
        [1.0, [0, 90, 0], [0, 5, 0]],
        ...
      ]]
    ]]
  ];
- Rotation Keyframes: Due to glTF Quaternion shortest-path interpolation, NEVER rotate more than 90 degrees between consecutive keyframes. To perform a full 360-degree rotation, you MUST manually subdivide it into 90-degree increments (e.g., 0, 90, 180, 270, 360).
- Translational & Rotational Keyframes: Keyframe translations and rotations are ABSOLUTE in local space. They completely replace the bone's resting 't' and 'r' attributes during the animation. If a bone's resting translation is [0, 0, 2] and it needs to move 10 units up, the keyframe translation must be [0, 0, 12]. If translation is omitted, it defaults to the resting position.

Example Animation & Skinning Usage:
\`\`\`openscad
anim_data = [
  ["Action 1", [
    ["TopBone", [
      [0.0, [0, 0, 0]],
      [1.0, [0, 45, 0]],
      [2.0, [0, 0, 0]]
    ]],
    ["Spinner", [
      [0.0, [0, 0, 0]],
      [1.0, [0, 0, 180]],
      [2.0, [0, 0, 360]]
    ]]
  ]]
];

armature(animations=anim_data) {
  // Skinned Soft Mesh (Placed at armature root, outside the bone hierarchy)
  // Blends smoothly from BottomBone (at Z=0) to TopBone (at Z=10)
  skin(bones=["BottomBone", "TopBone"], weights=function(x,y,z) [1.0 - (z/10), z/10]) {
    color([0.2, 0.6, 1.0]) cylinder(h=10, r=2, $fn=32);
  }

  // Bone Hierarchy
  bone(name="BottomBone", t=[0, 0, 0], r=[0, 0, 0]) {

    // Rigid mesh attached to BottomBone
    color("gray") cube([10, 10, 2], center=true);

    // Child Bone
    bone(name="TopBone", t=[0, 0, 10], r=[0, 0, 0]) {

      // Spinner attached to TopBone
      bone(name="Spinner", t=[0, 0, 0], r=[0, 0, 0]) {
        color("red") cylinder(h=2, r=4);
      }
    }
  }
}
\`\`\``;
  }

  if (opts.bakeColors || opts.bakeNormals || opts.bakeOrm || opts.bakeUvs) {
    const flags = [];
    const explanations = [];
    if (opts.bakeColors) {
      flags.push("colors=true");
      explanations.push(
        `- Set 'colors=true' (default false) to project and bake the high-poly's solid colors${opts.colormap ? " and procedural 'colormap' functions" : ""} onto the low-poly mesh.`,
      );
    }
    if (opts.bakeNormals) {
      flags.push("normals=true");
      explanations.push(
        "- Set 'normals=true' (default false) to project and bake the high-poly's physical geometric details as a tangent-space normal map onto the low-poly mesh.",
      );
    }
    if (opts.bakeOrm) {
      flags.push("orm=true");
      explanations.push(
        "- Set 'orm=true' (default false) to project and bake the high-poly's Roughness, and Metallic values onto the low-poly mesh.",
      );
    }
    if (opts.bakeUvs) {
      explanations.push(
        "- Single-child usage: Wrap an object in a \`bake()\` module (providing only 1 child) to automatically generate UV coordinates and Tangents (useful for standard texturing without a high-poly source). You can optionally override resolution or share atlases: \`bake(resolution=512, index=1)\`.",
      );
    }
    explanations.push(
      "- You can customize the baking process using 'distance' (max ray length, default: 2.0), 'bias' (ray origin offset, default: 1e-4), 'dilation' (pixel padding around UV islands, default: 2), 'resolution' (texture dimensions, default: 256), 'msaa' (super-sampling anti-aliasing level, default: 2), 'index' (atlas group identifier, default: 0), and 'rotate_uvs' (allow UV islands to be rotated for better packing, default: true).",
    );
    explanations.push(
      "- The 'index' parameter enables multi-atlas texture baking. By default (index=0), every baked mesh gets a unique separate texture atlas. Low-poly meshes configured with the same 'index' > 0 will be packed together into a shared texture atlas.",
    );

    flags.push("resolution=512");
    const bakeSig = flags.length > 0 ? `bake(${flags.join(", ")})` : "bake()";

    const explanationText =
      explanations.length > 0
        ? explanations.join("\n")
        : "- You can toggle what gets baked using the 'colors', 'normals', and 'orm' boolean parameters (all default to false).";

    let child1Source = `color("white") sphere(r=10, $fn=100); // Child 1: High Poly`;
    if (opts.colormap) {
      child1Source = `color("white", colormap=function(x,y,z) [sin(x*10)/2+0.5, cos(y*10)/2+0.5, 0.5, 1.0]) sphere(r=10, $fn=100); // Child 1: High Poly`;
    }

    prompt += `\n\nImportant Texture Baking rules:
- Baking: Use the 'bake()' module to project details from a high-resolution mesh onto a low-resolution mesh.
- UV Unwrapping: The engine automatically generates UV coordinates and bakes the textures for the low-poly child mesh; you do not need to manually map textures.
- Usage: The 'bake()' module strictly requires exactly TWO children. The FIRST child is the high-poly geometry, and the SECOND child is the low-poly geometry.
${explanationText}

Example Baking Usage:
\`\`\`openscad
// 1. Bake the selected details of a high-resolution sphere onto a low-resolution one
${bakeSig} {
  color("white") sphere(r=10, $fn=100); // Child 1: High Poly
  color("white", roughness=0.5, $asa=45) sphere(r=10, $fn=20); // Child 2: Low Poly
}

// 2. Alternatively, control texture resolution for a procedural colormap (1 child)
bake(resolution=512) {
  color("white", colormap=function(x,y,z) [sin(x*10)/2+0.5, cos(y*10)/2+0.5, 0.5, 1.0]) cube([10, 10, 10]);
}

// Alternatively, generate UVs/Tangents for a mesh WITHOUT a high-poly source by providing only 1 child
bake() {
  color("white") cube([10, 10, 10]);
}
\`\`\``;
  }

  if (opts.lights) {
    prompt += `\n\nImportant Lighting rules:
- Lights: Use the 'light()' module to add lights to the scene.
- Syntax: \`light(type="point", color=[1,1,1], intensity=2000.0, range=0.0, innerConeAngle=0.0, outerConeAngle=45.0) { ... }\`
- Supported light types: "directional", "point", "spot".
- Intensity (Physically Correct): Directional lights use Lux (e.g., 300-500 for indoor lighting, 100000 for the sun). Point and Spot lights use Candelas and decay over distance via the inverse-square law. They require VERY HIGH values (e.g., 1000.0 to 10000.0+) to illuminate objects!
- Orientation: A directional or spot light shines in the -Z direction by default. Use \`translate()\` and \`rotate()\` around the \`light()\` module to position and orient it.
- Spot lights accept \`innerConeAngle\` and \`outerConeAngle\` (in degrees). Point/Spot lights accept \`range\` (0.0 means infinite).
- Children inside a \`light()\` block are rendered normally in OpenSCAD and exported. The light transform automatically follows its enclosing transformations.

Example Lighting Usage:
\`\`\`openscad
// A spot light pointing down at an angle (Note the high intensity of 5000)
translate([0, 0, 50]) rotate([0, 30, 0])
  light(type="spot", color=[1, 0.8, 0.8], intensity=5000.0, innerConeAngle=15.0, outerConeAngle=30.0)
    color("gray") cylinder(h=2, r=1, center=true); // A visual representation of the light fixture
\`\`\``;
  }

  return prompt;
}
