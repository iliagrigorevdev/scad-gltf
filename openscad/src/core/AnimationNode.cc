#include "core/AnimationNode.h"
#include "core/Builtins.h"
#include "core/Children.h"
#include "core/Parameters.h"
#include "core/module.h"
#include "utils/degree_trig.h"

std::shared_ptr<AbstractNode> builtin_armature(const ModuleInstantiation *inst, Arguments arguments, const Children& children) {
    Parameters parameters = Parameters::parse(std::move(arguments), inst->location(), {"animations"});
    return children.instantiate(std::make_shared<ArmatureNode>(inst, parameters["animations"].clone()));
}

std::shared_ptr<AbstractNode> builtin_bone(const ModuleInstantiation *inst, Arguments arguments, const Children& children) {
    Parameters parameters = Parameters::parse(std::move(arguments), inst->location(), {"name", "t", "r"});

    std::string name = parameters["name"].toStrUtf8Wrapper().toString();

    Transform3d mat = Transform3d::Identity();

    Vector3d trans(0,0,0);
    if (parameters["t"].getVec3(trans[0], trans[1], trans[2], 0.0)) {
        mat.translate(trans);
    }

    Vector3d rot(0,0,0);
    if (parameters["r"].getVec3(rot[0], rot[1], rot[2], 0.0)) {
        mat.rotate(Eigen::AngleAxisd(rot[2] * M_PI/180.0, Vector3d::UnitZ()) *
                   Eigen::AngleAxisd(rot[1] * M_PI/180.0, Vector3d::UnitY()) *
                   Eigen::AngleAxisd(rot[0] * M_PI/180.0, Vector3d::UnitX()));
    }

    return children.instantiate(std::make_shared<BoneNode>(inst, name, mat));
}

void register_builtin_animation() {
    Builtins::init("armature", new BuiltinModule(builtin_armature), {"armature(animations=array)"});
    Builtins::init("bone", new BuiltinModule(builtin_bone), {"bone(name=\"\", t=[x,y,z], r=[x,y,z])"});
}
