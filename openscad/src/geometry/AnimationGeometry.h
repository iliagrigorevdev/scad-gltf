#pragma once
#include "geometry/Geometry.h"
#include "core/Value.h"
#include "geometry/linalg.h"

class ArmatureGeometry : public GeometryList {
public:
    Value animations;
    
    ArmatureGeometry(Value anims)
        : GeometryList(Geometry::Geometries()), animations(std::move(anims)) {}

    // Explicit copy constructor required because Value is move-only
    ArmatureGeometry(const ArmatureGeometry& other)
        : GeometryList(other), animations(other.animations.clone()) {}

    void accept(GeometryVisitor& visitor) const override {
        visitor.visit(static_cast<const GeometryList&>(*this)); 
    }
    size_t memsize() const override { return GeometryList::memsize() + sizeof(ArmatureGeometry); }
    std::unique_ptr<Geometry> copy() const override { return std::make_unique<ArmatureGeometry>(*this); }
    std::string dump() const override { return "ArmatureGeometry\n" + GeometryList::dump(); }
};

class BoneGeometry : public GeometryList {
public:
    std::string name;
    Transform3d local_matrix;

    BoneGeometry(std::string name, Transform3d matrix)
        : GeometryList(Geometry::Geometries()), name(std::move(name)), local_matrix(matrix) {}

    void accept(GeometryVisitor& visitor) const override {
        visitor.visit(static_cast<const GeometryList&>(*this)); 
    }
    size_t memsize() const override { return GeometryList::memsize() + sizeof(BoneGeometry); }
    std::unique_ptr<Geometry> copy() const override { return std::make_unique<BoneGeometry>(*this); }
    std::string dump() const override { return "BoneGeometry(" + name + ")\n" + GeometryList::dump(); }
};