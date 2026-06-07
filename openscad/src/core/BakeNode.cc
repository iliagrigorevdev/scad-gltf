#include "core/BakeNode.h"
#include "core/Arguments.h"
#include "core/Builtins.h"
#include "core/Children.h"
#include "core/module.h"
#include "core/Parameters.h"

std::shared_ptr<AbstractNode> builtin_bake(const ModuleInstantiation *inst, Arguments arguments, const Children& children) {
    Parameters parameters = Parameters::parse(std::move(arguments), inst->location(), {"colors", "normals", "distance", "bias", "dilation"});
    auto node = std::make_shared<BakeNode>(inst);

    if (parameters["colors"].type() == Value::Type::BOOL) {
        node->bake_colors = parameters["colors"].toBool();
    } else if (parameters["colors"].type() == Value::Type::NUMBER) {
        node->bake_colors = parameters["colors"].toDouble() != 0.0;
    }

    if (parameters["normals"].type() == Value::Type::BOOL) {
        node->bake_normals = parameters["normals"].toBool();
    } else if (parameters["normals"].type() == Value::Type::NUMBER) {
        node->bake_normals = parameters["normals"].toDouble() != 0.0;
    }

    if (parameters["distance"].type() == Value::Type::NUMBER) {
        node->distance = parameters["distance"].toDouble();
    }
    if (parameters["bias"].type() == Value::Type::NUMBER) {
        node->bias = parameters["bias"].toDouble();
    }
    if (parameters["dilation"].type() == Value::Type::NUMBER) {
        node->dilation = static_cast<int>(parameters["dilation"].toDouble());
    }

    return children.instantiate(node);
}

void register_builtin_bake() {
    Builtins::init("bake", new BuiltinModule(builtin_bake), {"bake(colors=false, normals=false, distance=2.0, bias=0.0001, dilation=8)"});
}
