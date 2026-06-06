#include "core/BakeNode.h"
#include "core/Arguments.h"
#include "core/Builtins.h"
#include "core/Children.h"
#include "core/module.h"

std::shared_ptr<AbstractNode> builtin_bake(const ModuleInstantiation *inst, Arguments arguments, const Children& children) {
    return children.instantiate(std::make_shared<BakeNode>(inst));
}

void register_builtin_bake() {
    Builtins::init("bake", new BuiltinModule(builtin_bake), {"bake()"});
}
