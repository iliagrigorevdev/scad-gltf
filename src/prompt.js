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
    bakeColors: options.bakeColors ?? false,
    bakeNormals: options.bakeNormals ?? false,
    autoSmoothAngle: options.autoSmoothAngle ?? true,
    animation: options.animation ?? true,
    lazyUnion: options.lazyUnion ?? false,
    modelName: options.modelName ?? true,
  };

  let prompt = `Generate an OpenSCAD script to design the following: ${description}.`;

  prompt += `\n\nImportant Output Rules:
- Export Target: The script will be compiled and exported as a GLB (glTF) file. This allows for node-based animations and extended PBR materials.
- Scale & Units: glTF treat 1 OpenSCAD unit as 1 Meter. Design your objects using realistic meter-based scales (e.g., a character should be ~1.8 units tall). DO NOT use millimeter-based scaling.`;

  if (opts.modelName) {
    prompt += `\n- You MUST wrap your code in a standard Markdown code block using the \`\`\`openscad language tag.
- Inside the code block, on the first line, include a block comment with a concise filename in snake_case (lowercase and underscores).
- Use this exact format: /* Model Name: your_model_name_here */`;
  }

  prompt += `\n- Coordinate System: Write standard OpenSCAD Z-up code (+Z is UP, XY plane is ground). DO NOT manually rotate or convert coordinates to match glTF's Y-up system; the GLB exporter handles the Z-up to Y-up conversion automatically. Build objects standing upright and facing Front (Positive Y-axis).
- Left/Right Convention: Always name and position "left" and "right" components (e.g., LeftArm, RightEye) based on the object's anatomical point of view (facing Forward towards +Y), NOT the camera/viewer's screen perspective. Because the object faces +Y, the object's Left side is along the -X axis, and the object's Right side is along the +X axis.`;

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

  if (attrs.length > 0 || opts.autoSmoothAngle) {
    if (attrs.length > 0) {
      prompt += `\n\nPlease utilize extended color attributes, specifically including ${attrs.join(", ")} parameters.`;
    }
    prompt += `\n\nImportant PBR & Shading rules:`;

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
    if (opts.autoSmoothAngle) {
      prompt += `\n- Auto Smooth Angle: Generates smooth vertex normals for adjoining faces with an angle difference less than this value (in degrees). Use > 0 (e.g., 30 or 45) for curved/smooth surfaces, 0.0 for flat shading. Can be set globally using the special variable $asa (e.g., $asa=30;), or overridden per-material via the $asa parameter INSIDE the color() module. IMPORTANT: $asa ONLY affects surface shading (normals). It DOES NOT alter the actual geometry or polygon count. You must still use standard variables like $fn to increase geometric resolution. DO NOT pass $asa directly to geometry modules like sphere() or cylinder(). (Default: 0.0)`;
    }

    let exampleParams = [];
    if (opts.basic) exampleParams.push("metalness=1.0", "roughness=0.3");
    if (opts.transmission) exampleParams.push("transmission=0.8", "ior=1.5");
    if (opts.clearcoat) exampleParams.push("clearcoat=1.0");
    if (opts.sheen) exampleParams.push("sheen=1.0");
    if (opts.iridescence) exampleParams.push("iridescence=1.0");
    if (opts.emissive)
      exampleParams.push("emissive=[0.0, 0.5, 1.0]", "emissiveIntensity=2.0");
    if (opts.specular) exampleParams.push("specularIntensity=1.0");
    if (opts.autoSmoothAngle) exampleParams.push("$asa=45.0");

    let exampleStr =
      exampleParams.length > 0 ? ", " + exampleParams.join(", ") : "";

    prompt += `\n\nExample Material Usage:\n// Syntax: color(c=color_value, alpha=1.0, [named PBR parameters...])\ncolor([0.2, 0.2, 0.2], alpha=1.0${exampleStr})\n  cube([10, 10, 10]);`;
  }

  if (opts.lazyUnion) {
    prompt += `\n\nImportant Geometry rules:\n- The compiler runs with "lazy-union" enabled. This means top-level objects, module children, and items inside loops ('for') or conditionals ('if') are NOT implicitly boolean-unioned together. They are evaluated and exported as separate discrete meshes.`;
  }

  if (opts.animation) {
    prompt += `\n\nImportant Animation rules:
- Wrapping: Use the 'armature(animations=...)' module at the root to wrap all animated components.
- Hierarchies: Use the 'bone(name="BoneName", t=[x,y,z], r=[x,y,z])' module to define hierarchical animated parts.
- Auto-Unioning: Any child meshes (e.g., cube, cylinder, imported objects) placed directly inside an 'armature()' or 'bone()' node are automatically unioned together by the engine. Child bones remain separate nodes in the hierarchy.
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

Example Animation Usage:
anim_data = [
  ["Action 1", [
    ["BaseSpinner", [
      [0.0, [0, 0, 0]],
      [1.0, [0, 0, 90]],
      [2.0, [0, 0, 180]],
      [3.0, [0, 0, 270]],
      [4.0, [0, 0, 360]]
    ]],
    ["ChildSlider", [
      [0.0, [0, 0, 0], [0, 0, 2]],
      [2.0, [0, 0, 0], [0, 0, 12]],
      [4.0, [0, 0, 0], [0, 0, 2]]
    ]]
  ]]
];

armature(animations=anim_data) {
  // Root bone
  bone(name="BaseSpinner", t=[0, 0, 0], r=[0, 0, 0]) {
    // Mesh attached to BaseSpinner
    color([0.2, 0.5, 0.8]) cube([10, 10, 2], center=true);

    // Nested child bone (inherits parent's transform)
    bone(name="ChildSlider", t=[0, 0, 2], r=[0, 0, 0]) {
      // Mesh attached to ChildSlider
      color([0.8, 0.2, 0.2]) cylinder(h=5, r=2);
    }
  }
}`;
  }

  if (opts.bakeColors || opts.bakeNormals) {
    const flags = [];
    const explanations = [];
    if (opts.bakeColors) {
      flags.push("colors=true");
      explanations.push(
        "- Set 'colors=true' (default false) to project and bake the high-poly's solid colors onto the low-poly mesh.",
      );
    }
    if (opts.bakeNormals) {
      flags.push("normals=true");
      explanations.push(
        "- Set 'normals=true' (default false) to project and bake the high-poly's physical geometric details as a tangent-space normal map onto the low-poly mesh.",
      );
    }
    explanations.push(
      "- You can customize the baking process using 'distance' (max ray length, default: 2.0), 'bias' (ray origin offset, default: 1e-4), 'dilation' (pixel padding around UV islands, default: 8), 'resolution' (texture dimensions, default: 2048), 'msaa' (super-sampling anti-aliasing level, default: 2), and 'index' (atlas group identifier, default: 0).",
    );
    explanations.push(
      "- The 'index' parameter enables multi-atlas texture baking. Low-poly meshes configured with the same 'index' will be packed together into a shared texture atlas, while meshes with distinct indices will be split into separate output image maps.",
    );
    flags.push("resolution=1024");
    flags.push("msaa=3");
    const bakeSig = flags.length > 0 ? `bake(${flags.join(", ")})` : "bake()";

    const explanationText =
      explanations.length > 0
        ? explanations.join("\n")
        : "- You can toggle what gets baked using the 'colors' and 'normals' boolean parameters (both default to false).";

    prompt += `\n\nImportant Texture Baking rules:
- Baking: Use the '${bakeSig}' module to project details from a high-resolution mesh onto a low-resolution mesh.
- UV Unwrapping: The engine automatically generates UV coordinates and bakes the textures for the low-poly child mesh; you do not need to manually map textures.
- Usage: The 'bake()' module strictly requires exactly TWO children. The FIRST child is the high-poly geometry, and the SECOND child is the low-poly geometry.
${explanationText}

Example Baking Usage:
// Bake the selected details of a high-resolution sphere onto a low-resolution one
${bakeSig} {
  color("white") sphere(r=10, $fn=100); // Child 1: High Poly
  color("white", roughness=0.5, $asa=45) sphere(r=10, $fn=20); // Child 2: Low Poly
}`;
  }

  return prompt;
}
