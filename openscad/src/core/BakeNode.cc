#include "core/BakeNode.h"
#include "core/Arguments.h"
#include "core/Builtins.h"
#include "core/Children.h"
#include "core/module.h"
#include "core/Parameters.h"

std::shared_ptr<AbstractNode> builtin_bake(const ModuleInstantiation *inst, Arguments arguments, const Children& children) {
    Parameters parameters = Parameters::parse(std::move(arguments), inst->location(), {"colors", "normals", "orm", "uvs", "distance", "bias", "dilation", "resolution", "msaa", "index", "rotate_uvs"});
    auto node = std::make_shared<BakeNode>(inst);

    if (parameters["colors"].type() == Value::Type::BOOL) {
        node->bake_params.bake_colors = parameters["colors"].toBool();
    } else if (parameters["colors"].type() == Value::Type::NUMBER) {
        node->bake_params.bake_colors = parameters["colors"].toDouble() != 0.0;
    }

    if (parameters["normals"].type() == Value::Type::BOOL) {
        node->bake_params.bake_normals = parameters["normals"].toBool();
    } else if (parameters["normals"].type() == Value::Type::NUMBER) {
        node->bake_params.bake_normals = parameters["normals"].toDouble() != 0.0;
    }

    if (parameters["orm"].type() == Value::Type::BOOL) {
        node->bake_params.bake_orm = parameters["orm"].toBool();
    } else if (parameters["orm"].type() == Value::Type::NUMBER) {
        node->bake_params.bake_orm = parameters["orm"].toDouble() != 0.0;
    }

    if (parameters["uvs"].type() == Value::Type::BOOL) {
        node->bake_params.bake_uvs = parameters["uvs"].toBool();
    } else if (parameters["uvs"].type() == Value::Type::NUMBER) {
        node->bake_params.bake_uvs = parameters["uvs"].toDouble() != 0.0;
    }

    if (parameters["distance"].type() == Value::Type::NUMBER) {
        node->bake_params.distance = parameters["distance"].toDouble();
    }
    if (parameters["bias"].type() == Value::Type::NUMBER) {
        node->bake_params.bias = parameters["bias"].toDouble();
    }
    if (parameters["dilation"].type() == Value::Type::NUMBER) {
        node->bake_params.dilation = static_cast<int>(parameters["dilation"].toDouble());
    }
    if (parameters["resolution"].type() == Value::Type::NUMBER) {
        node->bake_params.resolution = static_cast<int>(parameters["resolution"].toDouble());
    }
    if (parameters["msaa"].type() == Value::Type::NUMBER) {
        node->bake_params.msaa = static_cast<int>(parameters["msaa"].toDouble());
    }
    if (parameters["index"].type() == Value::Type::NUMBER) {
        node->bake_params.index = static_cast<int>(parameters["index"].toDouble());
    }

    if (parameters["rotate_uvs"].type() == Value::Type::BOOL) {
        node->bake_params.rotate_uvs = parameters["rotate_uvs"].toBool();
    } else if (parameters["rotate_uvs"].type() == Value::Type::NUMBER) {
        node->bake_params.rotate_uvs = parameters["rotate_uvs"].toDouble() != 0.0;
    }

    return children.instantiate(node);
}

void register_builtin_bake() {
    Builtins::init("bake", new BuiltinModule(builtin_bake), {"bake(colors=false, normals=false, orm=false, uvs=false, distance=2.0, bias=0.0001, dilation=undef, resolution=undef, msaa=undef, index=0, rotate_uvs=true)"});
}
