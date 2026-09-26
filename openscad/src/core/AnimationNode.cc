#include "core/AnimationNode.h"
#include "core/Builtins.h"
#include "core/Children.h"
#include "core/Parameters.h"
#include "core/module.h"
#include "utils/degree_trig.h"
#include "core/ColorUtil.h"

std::shared_ptr<AbstractNode> builtin_light(const ModuleInstantiation *inst, Arguments arguments, const Children& children) {
    Parameters parameters = Parameters::parse(std::move(arguments), inst->location(), {"type", "color", "intensity", "range", "innerConeAngle", "outerConeAngle"});

    std::string type = "point";
    if (parameters["type"].type() == Value::Type::STRING) {
        type = parameters["type"].toString();
    }

    Color4f color(1.0f, 1.0f, 1.0f, 1.0f);
    if (parameters["color"].type() == Value::Type::VECTOR) {
        const auto& vec = parameters["color"].toVector();
        Vector4f c;
        for (size_t i = 0; i < 4; ++i) {
            c[i] = i < vec.size() ? (float)vec[i].toDouble() : 1.0f;
        }
        color = c;
    } else if (parameters["color"].type() == Value::Type::STRING) {
        auto colorname = parameters["color"].toString();
        const auto parsed_color = OpenSCAD::parse_color(colorname);
        if (parsed_color) color = *parsed_color;
    }

    double intensity = 1.0;
    if (parameters["intensity"].type() == Value::Type::NUMBER) {
        intensity = parameters["intensity"].toDouble();
    }

    double range = 0.0;
    if (parameters["range"].type() == Value::Type::NUMBER) {
        range = parameters["range"].toDouble();
    }

    double innerConeAngle = 0.0;
    if (parameters["innerConeAngle"].type() == Value::Type::NUMBER) {
        innerConeAngle = parameters["innerConeAngle"].toDouble();
    }

    double outerConeAngle = 45.0;
    if (parameters["outerConeAngle"].type() == Value::Type::NUMBER) {
        outerConeAngle = parameters["outerConeAngle"].toDouble();
    }

    return children.instantiate(std::make_shared<LightNode>(inst, type, color, intensity, range, innerConeAngle, outerConeAngle));
}

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
    Builtins::init("light", new BuiltinModule(builtin_light), {"light(type=\"point\", color=[1,1,1], intensity=1.0, range=0.0, innerConeAngle=0.0, outerConeAngle=45.0)"});
}
