#pragma once
#include "core/node.h"
#include "core/ModuleInstantiation.h"
#include "geometry/Geometry.h"

class BakeNode : public AbstractNode {
public:
    VISITABLE();
    BakeNode(const ModuleInstantiation *mi) : AbstractNode(mi) {}
    std::string name() const override { return "bake"; }

    BakeParameters bake_params;
};

void register_builtin_bake();
