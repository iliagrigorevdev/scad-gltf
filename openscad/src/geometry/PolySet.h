#pragma once

#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "geometry/Geometry.h"
#include "geometry/GeometryUtils.h"
#include "geometry/Polygon2d.h"
#include "geometry/linalg.h"
#include "utils/boost-utils.h"

class PolySetBuilder;

class PolySet : public Geometry
{
  friend class PolySetBuilder;

public:
  VISITABLE_GEOMETRY();
  PolygonIndices indices;
  std::vector<Vector3d> vertices;
  std::shared_ptr<const PolySet> high_poly_bake;
  bool bake_colors = false;
  bool bake_normals = false;
  double bake_distance = 2.0;
  double bake_bias = 1e-4;
  int bake_dilation = 8;
  // Per polygon color, indexing the colors vector below. Can be empty, and -1 means no specific color.
  std::vector<int32_t> color_indices;
  std::vector<Color4f> colors;
  std::vector<float> roughnesses;
  std::vector<float> metalnesses;
  std::vector<float> clearcoats;
  std::vector<float> clearcoatRoughnesses;
  std::vector<float> sheens;
  std::vector<Color4f> sheenColors;
  std::vector<float> sheenRoughnesses;
  std::vector<float> transmissions;
  std::vector<float> thicknesses;
  std::vector<Color4f> attenuationColors;
  std::vector<float> attenuationDistances;
  std::vector<float> iors;
  std::vector<Color4f> emissives;
  std::vector<float> emissiveIntensities;
  std::vector<Color4f> specularColors;
  std::vector<float> specularIntensities;
  std::vector<float> iridescences;
  std::vector<float> iridescenceIORs;
  std::vector<float> autoSmoothAngles;

  PolySet(unsigned int dim, boost::tribool convex = unknown);

  size_t memsize() const override;
  BoundingBox getBoundingBox() const override;
  std::string dump() const override;
  unsigned int getDimension() const override { return dim_; }
  bool isEmpty() const override { return indices.empty(); }
  std::unique_ptr<Geometry> copy() const override;

  void quantizeVertices(std::vector<Vector3d> *pPointsOut = nullptr);
  size_t numFacets() const override { return indices.size(); }
  void transform(const Transform3d& mat) override;
  void resize(const Vector3d& newsize, const Eigen::Matrix<bool, 3, 1>& autosize) override;
  void setColor(const Color4f& c, float roughness = 1.0f, float metalness = 0.0f, float clearcoat = 0.0f, float clearcoatRoughness = 0.0f, float sheen = 0.0f, const Color4f& sheenColor = {}, float sheenRoughness = 0.0f, float transmission = 0.0f, float thickness = 0.0f, const Color4f& attenuationColor = {}, float attenuationDistance = 0.0f, float ior = 1.5f, const Color4f& emissive = {}, float emissiveIntensity = 1.0f, const Color4f& specularColor = {}, float specularIntensity = 1.0f, float iridescence = 0.0f, float iridescenceIOR = 1.3f, float autoSmoothAngle = 0.0f) override;

  bool isConvex() const;
  boost::tribool convexValue() const { return convex_; }

  bool isManifold() const { return is_manifold_; }
  void setManifold(bool manifold) { is_manifold_ = manifold; }

  bool isTriangular() const { return is_triangular_; }
  void setTriangular(bool triangular) { is_triangular_ = triangular; }

  static std::unique_ptr<PolySet> createEmpty() { return std::make_unique<PolySet>(3); }

private:
  bool is_triangular_ = false;
  unsigned int dim_;
  mutable boost::tribool convex_;
  mutable BoundingBox bbox_;

  // Sometimes it's useful to know whether a PolySet was created from a source guaranteed to be manifold
  // (e.g. ManifoldGeometry), as that can make conversion and repair more convenient.
  // "Manifold" is defined as an ε-valid mesh, see
  // https://github.com/elalish/manifold/wiki/Manifold-Library#definition-of-%CE%B5-valid
  bool is_manifold_ = false;  // false means "unknown"
};
