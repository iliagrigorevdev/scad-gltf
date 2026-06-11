#include "core/BakeNode.h"
#include "core/Arguments.h"
#include "core/Builtins.h"
#include "core/Children.h"
#include "core/module.h"
#include "core/Parameters.h"

std::shared_ptr<AbstractNode> builtin_bake(const ModuleInstantiation *inst, Arguments arguments, const Children& children) {
    Parameters parameters = Parameters::parse(std::move(arguments), inst->location(), {"colors", "normals", "orm", "ao", "distance", "bias", "dilation", "resolution", "msaa", "index", "ao_samples", "ao_distance"});
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

    if (parameters["orm"].type() == Value::Type::BOOL) {
        node->bake_orm = parameters["orm"].toBool();
    } else if (parameters["orm"].type() == Value::Type::NUMBER) {
        node->bake_orm = parameters["orm"].toDouble() != 0.0;
    }

    if (parameters["ao"].type() == Value::Type::BOOL) {
        node->bake_ao = parameters["ao"].toBool();
    } else if (parameters["ao"].type() == Value::Type::NUMBER) {
        node->bake_ao = parameters["ao"].toDouble() != 0.0;
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
    if (parameters["resolution"].type() == Value::Type::NUMBER) {
        node->resolution = static_cast<int>(parameters["resolution"].toDouble());
    }
    if (parameters["msaa"].type() == Value::Type::NUMBER) {
        node->msaa = static_cast<int>(parameters["msaa"].toDouble());
    }
    if (parameters["index"].type() == Value::Type::NUMBER) {
        node->index = static_cast<int>(parameters["index"].toDouble());
    }
    if (parameters["ao_samples"].type() == Value::Type::NUMBER) {
        node->ao_samples = static_cast<int>(parameters["ao_samples"].toDouble());
    }
    if (parameters["ao_distance"].type() == Value::Type::NUMBER) {
        node->ao_distance = parameters["ao_distance"].toDouble();
    }

    return children.instantiate(node);
}

void register_builtin_bake() {
    Builtins::init("bake", new BuiltinModule(builtin_bake), {"bake(colors=false, normals=false, orm=false, ao=false, distance=2.0, bias=0.0001, dilation=2, resolution=512, msaa=2, index=0, ao_samples=16, ao_distance=10.0)"});
}
