#pragma once

#include <string>

#include "core/BaseVisitable.h"
#include "core/ModuleInstantiation.h"
#include "core/node.h"
#include "geometry/linalg.h"

class ColorNode : public AbstractNode
{
public:
  VISITABLE();
  ColorNode(const ModuleInstantiation *mi) : AbstractNode(mi) {}
  std::string toString() const override;
  std::string name() const override;

  Color4f color;
  float roughness = 1.0f;
  float metalness = 0.0f;
  float clearcoat = 0.0f;
  float clearcoatRoughness = 0.0f;
  float sheen = 0.0f;
  Color4f sheenColor;
  float sheenRoughness = 0.0f;
  float transmission = 0.0f;
  float thickness = 0.0f;
  Color4f attenuationColor;
  float attenuationDistance = 0.0f;
  float ior = 1.5f;
  Color4f emissive;
  float emissiveIntensity = 1.0f;
  Color4f specularColor;
  float specularIntensity = 1.0f;
  float iridescence = 0.0f;
  float iridescenceIOR = 1.3f;
  float anisotropy = 0.0f;
  float anisotropyRotation = 0.0f;
};
