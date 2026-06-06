// src/core/BakeNode.h
#pragma once
#include "core/node.h"
#include "core/ModuleInstantiation.h"

class BakeNode : public AbstractNode {
public:
    VISITABLE();
    BakeNode(const ModuleInstantiation *mi) : AbstractNode(mi) {}
    std::string name() const override { return "bake"; }
};

void register_builtin_bake();
