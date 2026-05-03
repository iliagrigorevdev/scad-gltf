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
  float roughness = 0.0f;
  float metalness = 0.0f;
  float clearcoat = 0.0f;
  float clearcoatRoughness = 0.0f;
};
