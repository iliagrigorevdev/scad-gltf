#!/bin/bash

# Check if at least one argument is provided
if [ $# -eq 0 ]; then
  echo "Error: Prompt argument is required." >&2
  echo "Usage: $0 \"<your prompt here>\"" >&2
  exit 1
fi

# Openscad GLTF changes: g d 5b699719103b7cf3f7be6a1a6a5dea1d96403250..d023d54bfc060c15188f9f55b6679a22d7e34813 openscad

# Echo the prompt and pipe it into clip.sh along with the formatted file list
echo "$*" | ../clip.sh \
  openscad/src/core/AnimationNode.* \
  openscad/src/core/BakeNode.* \
  openscad/src/core/Builtins.cc \
  openscad/src/core/CSGTreeEvaluator.* \
  openscad/src/core/ColorNode.* \
  openscad/src/core/ContextMemoryManager.cc \
  openscad/src/core/NodeVisitor.h \
  openscad/src/geometry/AnimationGeometry.h \
  openscad/src/geometry/Geometry.h \
  openscad/src/geometry/GeometryEvaluator.* \
  openscad/src/geometry/PolySet.* \
  openscad/src/geometry/PolySetBuilder.* \
  openscad/src/geometry/PolySetUtils.cc \
  openscad/src/geometry/cgal/cgalutils.cc \
  openscad/src/geometry/manifold/ManifoldGeometry.* \
  openscad/src/geometry/manifold/manifoldutils.cc \
  openscad/src/io/export.* \
  openscad/src/io/export_gltf.cc
