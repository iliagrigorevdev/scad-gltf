#pragma once
#include "core/TransformNode.h"
#include "core/node.h"
#include "core/Value.h"

class LightNode : public AbstractNode {
public:
    VISITABLE();
    std::string light_type;
    Color4f color;
    double intensity;
    double range;
    double innerConeAngle;
    double outerConeAngle;

    LightNode(const ModuleInstantiation *mi, std::string type, Color4f c, double i, double r, double inner, double outer)
      : AbstractNode(mi), light_type(std::move(type)), color(c), intensity(i), range(r), innerConeAngle(inner), outerConeAngle(outer) {
    }
    std::string name() const override { return "light"; }
};

class ArmatureNode : public AbstractNode {
public:
    VISITABLE();
    Value animations;
    ArmatureNode(const ModuleInstantiation *mi, Value anims) : AbstractNode(mi), animations(std::move(anims)) {}
    std::string name() const override { return "armature"; }
};

class BoneNode : public TransformNode {
public:
    VISITABLE();
    std::string bone_name;
    BoneNode(const ModuleInstantiation *mi, std::string name, const Transform3d& mat)
      : TransformNode(mi, "bone"), bone_name(std::move(name)) {
        this->matrix = mat;
    }
    std::string name() const override { return "bone"; }

    // Override toString to explicitly bake the bone name into OpenSCAD's AST geometry cache key.
    // This prevents aggressively deduplicating identically-shaped structural bone branches.
    std::string toString() const override {
        return this->name() + "(\"" + this->bone_name + "\") " + TransformNode::toString();
    }
};

void register_builtin_animation();
