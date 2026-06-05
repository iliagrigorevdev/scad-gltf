#pragma once

#include <string>

#include "core/BaseVisitable.h"
#include "core/ModuleInstantiation.h"
#include "core/node.h"
#include "geometry/linalg.h"
#include "core/Value.h"

class ColorNode : public AbstractNode
{
public:
  VISITABLE();
  ColorNode(const ModuleInstantiation *mi) : AbstractNode(mi), colormap(Value::undef("default")) {}
  ColorNode(const ColorNode& other) : AbstractNode(other.modinst), colormap(other.colormap.clone())
  {
    color = other.color;
    roughness = other.roughness;
    metalness = other.metalness;
    clearcoat = other.clearcoat;
    clearcoatRoughness = other.clearcoatRoughness;
    sheen = other.sheen;
    sheenColor = other.sheenColor;
    sheenRoughness = other.sheenRoughness;
    transmission = other.transmission;
    thickness = other.thickness;
    attenuationColor = other.attenuationColor;
    attenuationDistance = other.attenuationDistance;
    ior = other.ior;
    emissive = other.emissive;
    emissiveIntensity = other.emissiveIntensity;
    specularColor = other.specularColor;
    specularIntensity = other.specularIntensity;
    iridescence = other.iridescence;
    iridescenceIOR = other.iridescenceIOR;
    autoSmoothAngle = other.autoSmoothAngle;
  }
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
  float autoSmoothAngle = 0.0f;
  Value colormap;
};
