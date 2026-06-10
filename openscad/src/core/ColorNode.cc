/*
 *  OpenSCAD (www.openscad.org)
 *  Copyright (C) 2009-2011 Clifford Wolf <clifford@clifford.at> and
 *                          Marius Kintel <marius@kintel.net>
 *
 *  This program is free software; you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation; either version 2 of the License, or
 *  (at your option) any later version.
 *
 *  As a special exception, you have permission to link this program
 *  with the CGAL library and distribute executables, as long as you
 *  follow the requirements of the GNU GPL in regard to all of the
 *  software in the executable aside from CGAL.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program; if not, write to the Free Software
 *  Foundation, Inc., 59 Temple Place, Suite 330, Boston, MA  02111-1307  USA
 *
 */

#include "core/ColorNode.h"

#include <boost/algorithm/string/case_conv.hpp>
#include <boost/assign/list_of.hpp>
#include <boost/assign/std/vector.hpp>
#include <cctype>
#include <cstddef>
#include <memory>
#include <string>
#include <utility>

#include "core/Builtins.h"
#include "core/Children.h"
#include "core/ColorUtil.h"
#include "core/ModuleInstantiation.h"
#include "core/Parameters.h"
#include "core/module.h"
#include "geometry/linalg.h"
#include "utils/printutils.h"

using namespace boost::assign;  // bring 'operator+=()' into scope

static std::shared_ptr<AbstractNode> builtin_color(const ModuleInstantiation *inst, Arguments arguments,
                                                   const Children& children)
{
  auto node = std::make_shared<ColorNode>(inst);

  Vector4f defaultBlack;
  defaultBlack[0] = 0.0f; defaultBlack[1] = 0.0f; defaultBlack[2] = 0.0f; defaultBlack[3] = 1.0f;

  Vector4f defaultWhite;
  defaultWhite[0] = 1.0f; defaultWhite[1] = 1.0f; defaultWhite[2] = 1.0f; defaultWhite[3] = 1.0f;

  node->material.sheenColor = defaultBlack;
  node->material.attenuationColor = defaultWhite;
  node->material.emissive = defaultBlack;
  node->material.specularColor = defaultWhite;

  Parameters parameters = Parameters::parse(std::move(arguments), inst->location(), {"c", "alpha", "roughness", "metalness", "clearcoat", "clearcoatRoughness", "sheen", "sheenColor", "sheenRoughness", "transmission", "thickness", "attenuationColor", "attenuationDistance", "ior", "emissive", "emissiveIntensity", "specularColor", "specularIntensity", "iridescence", "iridescenceIOR"});
  if (parameters["c"].type() == Value::Type::VECTOR) {
    const auto& vec = parameters["c"].toVector();
    Vector4f color;
    for (size_t i = 0; i < 4; ++i) {
      color[i] = i < vec.size() ? (float)vec[i].toDouble() : 1.0f;
      if (color[i] > 1 || color[i] < 0) {
        LOG(message_group::Warning, inst->location(), parameters.documentRoot(),
            "color() expects numbers between 0.0 and 1.0. Value of %1$.1f is out of range", color[i]);
      }
    }
    node->material.color = color;
  } else if (parameters["c"].type() == Value::Type::STRING) {
    auto colorname = parameters["c"].toString();
    const auto parsed_color = OpenSCAD::parse_color(colorname);
    if (parsed_color) {
      node->material.color = *parsed_color;
    } else {
      LOG(message_group::Warning, inst->location(), parameters.documentRoot(),
          "Unable to parse color \"%1$s\"", colorname);
      LOG(message_group::HtmlLink,
          "For a list of valid color names, see the <a href=\"open-window://colorlist\"><b>Color "
          "List</b></a> window.");
    }
  }
  if (parameters["alpha"].type() == Value::Type::NUMBER) {
    node->material.color.setAlpha(parameters["alpha"].toDouble());
    if (node->material.color.a() < 0.0f || node->material.color.a() > 1.0f) {
      LOG(message_group::Warning, inst->location(), parameters.documentRoot(),
          "color() expects alpha between 0.0 and 1.0. Value of %1$.1f is out of range", node->material.color.a());
    }
  }

  if (parameters["roughness"].type() == Value::Type::NUMBER) {
    node->material.roughness = parameters["roughness"].toDouble();
  }
  if (parameters["metalness"].type() == Value::Type::NUMBER) {
    node->material.metalness = parameters["metalness"].toDouble();
  }
  if (parameters["clearcoat"].type() == Value::Type::NUMBER) {
    node->material.clearcoat = parameters["clearcoat"].toDouble();
  }
  if (parameters["clearcoatRoughness"].type() == Value::Type::NUMBER) {
    node->material.clearcoatRoughness = parameters["clearcoatRoughness"].toDouble();
  }

  if (parameters["sheen"].type() == Value::Type::NUMBER) {
    node->material.sheen = parameters["sheen"].toDouble();
  }

  auto parseColor = [&](const std::string& key, Color4f& outColor, const Color4f& defaultColor) {
    if (parameters[key].type() == Value::Type::VECTOR) {
      const auto& vec = parameters[key].toVector();
      Vector4f color;
      for (size_t i = 0; i < 3; ++i) {
        color[i] = i < vec.size() ? (float)vec[i].toDouble() : 0.0f;
        if (color[i] > 1 || color[i] < 0) {
          LOG(message_group::Warning, inst->location(), parameters.documentRoot(),
              "color() %1$s expects numbers between 0.0 and 1.0. Value of %2$.1f is out of range", key, color[i]);
        }
      }
      color[3] = 1.0f;
      outColor = color;
    } else if (parameters[key].type() == Value::Type::STRING) {
      auto colorname = parameters[key].toString();
      const auto parsed_color = OpenSCAD::parse_color(colorname);
      if (parsed_color) outColor = *parsed_color;
      else LOG(message_group::Warning, inst->location(), parameters.documentRoot(), "Unable to parse color \"%1$s\"", colorname);
    }
  };

  parseColor("sheenColor", node->material.sheenColor, defaultBlack);
  parseColor("attenuationColor", node->material.attenuationColor, defaultWhite);
  parseColor("emissive", node->material.emissive, defaultBlack);
  parseColor("specularColor", node->material.specularColor, defaultWhite);

  if (parameters["sheenRoughness"].type() == Value::Type::NUMBER) {
    node->material.sheenRoughness = parameters["sheenRoughness"].toDouble();
  }
  if (parameters["transmission"].type() == Value::Type::NUMBER) {
    node->material.transmission = parameters["transmission"].toDouble();
  }
  if (parameters["thickness"].type() == Value::Type::NUMBER) {
    node->material.thickness = parameters["thickness"].toDouble();
  }
  if (parameters["attenuationDistance"].type() == Value::Type::NUMBER) {
    node->material.attenuationDistance = parameters["attenuationDistance"].toDouble();
  }
  if (parameters["ior"].type() == Value::Type::NUMBER) {
    node->material.ior = parameters["ior"].toDouble();
  }
  if (parameters["emissiveIntensity"].type() == Value::Type::NUMBER) {
    node->material.emissiveIntensity = parameters["emissiveIntensity"].toDouble();
  }
  if (parameters["specularIntensity"].type() == Value::Type::NUMBER) {
    node->material.specularIntensity = parameters["specularIntensity"].toDouble();
  }
  if (parameters["iridescence"].type() == Value::Type::NUMBER) {
    node->material.iridescence = parameters["iridescence"].toDouble();
  }
  if (parameters["iridescenceIOR"].type() == Value::Type::NUMBER) {
    node->material.iridescenceIOR = parameters["iridescenceIOR"].toDouble();
  }
  if (parameters["$asa"].type() == Value::Type::NUMBER) {
    node->material.autoSmoothAngle = parameters["$asa"].toDouble();
  }

  return children.instantiate(node);
}

std::string ColorNode::toString() const
{
  return STR("color([", this->material.color.r(), ", ", this->material.color.g(), ", ", this->material.color.b(), ", ",
             this->material.color.a(), "], roughness=", this->material.roughness, ", metalness=", this->material.metalness,
             ", clearcoat=", this->material.clearcoat, ", clearcoatRoughness=", this->material.clearcoatRoughness,
             ", sheen=", this->material.sheen, ", sheenColor=[", this->material.sheenColor.r(), ", ", this->material.sheenColor.g(), ", ", this->material.sheenColor.b(), "], sheenRoughness=", this->material.sheenRoughness,
             ", transmission=", this->material.transmission, ", thickness=", this->material.thickness,
             ", attenuationColor=[", this->material.attenuationColor.r(), ", ", this->material.attenuationColor.g(), ", ", this->material.attenuationColor.b(), "], attenuationDistance=", this->material.attenuationDistance, ", ior=", this->material.ior,
             ", emissive=[", this->material.emissive.r(), ", ", this->material.emissive.g(), ", ", this->material.emissive.b(), "], emissiveIntensity=", this->material.emissiveIntensity,
             ", specularColor=[", this->material.specularColor.r(), ", ", this->material.specularColor.g(), ", ", this->material.specularColor.b(), "], specularIntensity=", this->material.specularIntensity,
             ", iridescence=", this->material.iridescence, ", iridescenceIOR=", this->material.iridescenceIOR,
             ", $asa=", this->material.autoSmoothAngle, ")");
}

std::string ColorNode::name() const
{
  return "color";
}

void register_builtin_color()
{
  const char* full_params = ", roughness = 1.0, metalness = 0.0, clearcoat = 0.0, clearcoatRoughness = 0.0, sheen = 0.0, sheenColor =[0.0, 0.0, 0.0], sheenRoughness = 0.0, transmission = 0.0, thickness = 0.0, attenuationColor =[1.0, 1.0, 1.0], attenuationDistance = 0.0, ior = 1.5, emissive =[0.0, 0.0, 0.0], emissiveIntensity = 1.0, specularColor =[1.0, 1.0, 1.0], specularIntensity = 1.0, iridescence = 0.0, iridescenceIOR = 1.3)";
  Builtins::init("color", new BuiltinModule(builtin_color),
                 {
                   STR("color(c =[r, g, b, a]", full_params),
                   STR("color(c =[r, g, b], alpha = 1.0", full_params),
                   STR("color(\"#hexvalue\"", full_params),
                   STR("color(\"colorname\", 1.0", full_params),
                 });
}
