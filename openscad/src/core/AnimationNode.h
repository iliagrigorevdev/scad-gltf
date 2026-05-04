#pragma once
#include "core/TransformNode.h"
#include "core/node.h"
#include "core/Value.h"

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
};

void register_builtin_animation();