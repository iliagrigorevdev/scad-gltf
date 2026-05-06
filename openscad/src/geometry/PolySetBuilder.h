#pragma once

#include <cstdint>
#include <memory>
#include <vector>

#include "geometry/Geometry.h"
#include "geometry/GeometryUtils.h"
#include "geometry/Polygon2d.h"
#include "geometry/Reindexer.h"
#include "geometry/linalg.h"
#include "utils/boost-utils.h"

class PolySet;

class PolySetBuilder
{
public:
  PolySetBuilder(int vertices_count = 0, int indices_count = 0, int dim = 3,
                 boost::tribool convex = unknown);
  void reserve(int vertices_count = 0, int indices_count = 0);
  void setConvexity(int n);
  int vertexIndex(const Vector3d& coord);
  int numVertices() const;
  int numPolygons() const;
  bool isEmpty() const;

  void appendPolySet(const PolySet& ps);
  void appendGeometry(const std::shared_ptr<const Geometry>& geom);
  void appendPolygon(const std::vector<int>& inds);
  void appendPolygon(const std::vector<Vector3d>& v);

  void beginPolygon(int nvertices);
  void addVertex(int ind);
  void addVertex(const Vector3d& v);
  // Calling this is optional; will be called automatically when adding a new polygon or building the
  // PolySet
  void endPolygon(const Color4f& color = {}, float roughness = 1.0f, float metalness = 0.0f, float clearcoat = 0.0f, float clearcoatRoughness = 0.0f, float sheen = 0.0f, const Color4f& sheenColor = {}, float sheenRoughness = 0.0f, float transmission = 0.0f, float thickness = 0.0f, const Color4f& attenuationColor = {}, float attenuationDistance = 0.0f, float ior = 1.5f, const Color4f& emissive = {}, float emissiveIntensity = 1.0f, const Color4f& specularColor = {}, float specularIntensity = 1.0f, float iridescence = 0.0f, float iridescenceIOR = 1.3f, float anisotropy = 0.0f, float anisotropyRotation = 0.0f);

  void addColor(const Color4f& color, float roughness = 1.0f, float metalness = 0.0f, float clearcoat = 0.0f, float clearcoatRoughness = 0.0f, float sheen = 0.0f, const Color4f& sheenColor = {}, float sheenRoughness = 0.0f, float transmission = 0.0f, float thickness = 0.0f, const Color4f& attenuationColor = {}, float attenuationDistance = 0.0f, float ior = 1.5f, const Color4f& emissive = {}, float emissiveIntensity = 1.0f, const Color4f& specularColor = {}, float specularIntensity = 1.0f, float iridescence = 0.0f, float iridescenceIOR = 1.3f, float anisotropy = 0.0f, float anisotropyRotation = 0.0f);
  void addColorIndex(int idx);  // should be paired with begin/endPolygon()

  std::unique_ptr<PolySet> build();

private:
  Reindexer<Vector3d> vertices_;
  PolygonIndices indices_;
  std::vector<int32_t> color_indices_;
  std::vector<Color4f> colors_;
  std::vector<float> roughnesses_;
  std::vector<float> metalnesses_;
  std::vector<float> clearcoats_;
  std::vector<float> clearcoatRoughnesses_;
  std::vector<float> sheens_;
  std::vector<Color4f> sheenColors_;
  std::vector<float> sheenRoughnesses_;
  std::vector<float> transmissions_;
  std::vector<float> thicknesses_;
  std::vector<Color4f> attenuationColors_;
  std::vector<float> attenuationDistances_;
  std::vector<float> iors_;
  std::vector<Color4f> emissives_;
  std::vector<float> emissiveIntensities_;
  std::vector<Color4f> specularColors_;
  std::vector<float> specularIntensities_;
  std::vector<float> iridescences_;
  std::vector<float> iridescenceIORs_;
  std::vector<float> anisotropies_;
  std::vector<float> anisotropyRotations_;
  int convexity_{1};
  int dim_;
  boost::tribool convex_;

  // Will be initialized by beginPolygon() and cleared by endPolygon()
  IndexedFace current_polygon_;
};
