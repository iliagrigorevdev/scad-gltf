#pragma once

#include <cassert>
#include <cstddef>
#include <list>
#include <memory>
#include <string>
#include <utility>

#include <tuple>
#include "geometry/linalg.h"

struct MaterialProperties {
  Color4f color;
  float roughness = 1.0f;
  float metalness = 0.0f;
  float clearcoat = 0.0f;
  float clearcoatRoughness = 0.0f;
  float sheen = 0.0f;
  Color4f sheenColor;
  float sheenRoughness = 0.0f;
  float transmission = 0.0f;
  float thickness = 0.0f;
  Color4f attenuationColor;
  float attenuationDistance = 0.0f;
  float ior = 1.5f;
  Color4f emissive;
  float emissiveIntensity = 1.0f;
  Color4f specularColor;
  float specularIntensity = 1.0f;
  float iridescence = 0.0f;
  float iridescenceIOR = 1.3f;
  float autoSmoothAngle = 0.0f;

  MaterialProperties() {
    Vector4f defBlack; defBlack[0]=0.0f; defBlack[1]=0.0f; defBlack[2]=0.0f; defBlack[3]=1.0f;
    Vector4f defWhite; defWhite[0]=1.0f; defWhite[1]=1.0f; defWhite[2]=1.0f; defWhite[3]=1.0f;
    sheenColor = defBlack;
    attenuationColor = defWhite;
    emissive = defBlack;
    specularColor = defWhite;
  }

  bool isValid() const { return color.isValid(); }

  auto to_tuple() const {
    return std::make_tuple(
        color.r(), color.g(), color.b(), color.a(),
        roughness, metalness, clearcoat, clearcoatRoughness,
        sheen, sheenColor.r(), sheenColor.g(), sheenColor.b(), sheenColor.a(), sheenRoughness,
        transmission, thickness, attenuationColor.r(), attenuationColor.g(), attenuationColor.b(), attenuationColor.a(), attenuationDistance,
        ior, emissive.r(), emissive.g(), emissive.b(), emissive.a(), emissiveIntensity,
        specularColor.r(), specularColor.g(), specularColor.b(), specularColor.a(), specularIntensity,
        iridescence, iridescenceIOR, autoSmoothAngle
    );
  }

  bool operator==(const MaterialProperties& other) const { return to_tuple() == other.to_tuple(); }
  bool operator<(const MaterialProperties& other) const { return to_tuple() < other.to_tuple(); }
};

class AbstractNode;
class CGALNefGeometry;
class GeometryList;
class GeometryVisitor;
class Polygon2d;
class PolySet;
#ifdef ENABLE_MANIFOLD
class ManifoldGeometry;
#endif

class Geometry
{
public:
  using GeometryItem = std::pair<std::shared_ptr<const AbstractNode>, std::shared_ptr<const Geometry>>;
  using Geometries = std::list<GeometryItem>;

  Geometry() = default;
  Geometry(const Geometry&) = default;
  Geometry& operator=(const Geometry&) = default;
  Geometry(Geometry&&) = default;
  Geometry& operator=(Geometry&&) = default;
  virtual ~Geometry() = default;

  [[nodiscard]] virtual size_t memsize() const = 0;
  [[nodiscard]] virtual BoundingBox getBoundingBox() const = 0;
  [[nodiscard]] virtual std::string dump() const = 0;
  [[nodiscard]] virtual unsigned int getDimension() const = 0;
  [[nodiscard]] virtual bool isEmpty() const = 0;
  [[nodiscard]] virtual std::unique_ptr<Geometry> copy() const = 0;
  [[nodiscard]] virtual size_t numFacets() const = 0;
  [[nodiscard]] unsigned int getConvexity() const { return convexity; }
  void setConvexity(int c) { this->convexity = c; }
  virtual void setColor(const MaterialProperties& properties) {}

  virtual void transform(const Transform3d& /*mat*/) { assert(!"transform not implemented!"); }
  virtual void resize(const Vector3d& /*newsize*/, const Eigen::Matrix<bool, 3, 1>& /*autosize*/)
  {
    assert(!"resize not implemented!");
  }

  virtual void accept(GeometryVisitor& visitor) const = 0;

protected:
  int convexity{1};
};

/**
 * A Base class for simple visitors to process different Geometry subclasses uniformly
 */
class GeometryVisitor
{
public:
  virtual void visit(const GeometryList& node) = 0;
  virtual void visit(const PolySet& node) = 0;
  virtual void visit(const Polygon2d& node) = 0;
#ifdef ENABLE_CGAL
  virtual void visit(const CGALNefGeometry& node) = 0;
#endif
#ifdef ENABLE_MANIFOLD
  virtual void visit(const ManifoldGeometry& node) = 0;
#endif
  virtual ~GeometryVisitor() = default;
};

#define VISITABLE_GEOMETRY()                           \
  void accept(GeometryVisitor& visitor) const override \
  {                                                    \
    visitor.visit(*this);                              \
  }

class GeometryList : public Geometry
{
public:
  VISITABLE_GEOMETRY();
  Geometries children;

  GeometryList();
  GeometryList(Geometry::Geometries geometries);

  [[nodiscard]] size_t memsize() const override;
  [[nodiscard]] BoundingBox getBoundingBox() const override;
  [[nodiscard]] std::string dump() const override;
  [[nodiscard]] unsigned int getDimension() const override;
  [[nodiscard]] bool isEmpty() const override;
  [[nodiscard]] std::unique_ptr<Geometry> copy() const override;
  [[nodiscard]] size_t numFacets() const override
  {
    assert(false && "not implemented");
    return 0;
  }

  [[nodiscard]] const Geometries& getChildren() const { return this->children; }

  [[nodiscard]] Geometries flatten() const;

  void transform(const Transform3d& mat) override {
    for (auto& item : children) {
      if (item.second) {
        auto new_geom = item.second->copy();
        new_geom->transform(mat);
        item.second = std::move(new_geom);
      }
    }
  }

  void setColor(const MaterialProperties& properties) override {
    for (auto& item : children) {
      if (item.second) {
        auto new_geom = item.second->copy();
        new_geom->setColor(properties);
        item.second = std::move(new_geom);
      }
    }
  }
};
