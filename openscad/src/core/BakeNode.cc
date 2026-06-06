#include "core/BakeNode.h"
#include "core/Arguments.h"
#include "core/Builtins.h"
#include "core/Children.h"
#include "core/module.h"
#include "core/Parameters.h"

std::shared_ptr<AbstractNode> builtin_bake(const ModuleInstantiation *inst, Arguments arguments, const Children& children) {
    Parameters parameters = Parameters::parse(std::move(arguments), inst->location(), {"colors", "normals"});
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

    return children.instantiate(node);
}

void register_builtin_bake() {
    Builtins::init("bake", new BuiltinModule(builtin_bake), {"bake(colors=false, normals=false)"});
}
