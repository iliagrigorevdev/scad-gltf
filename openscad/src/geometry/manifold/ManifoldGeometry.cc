// Portions of this file are Copyright 2023 Google LLC, and licensed under GPL2+. See COPYING.
#include "geometry/manifold/ManifoldGeometry.h"

#include <manifold/cross_section.h>
#include <manifold/manifold.h>

#include <cstddef>
#include <cstdint>
#include <exception>
#include <functional>
#include <map>
#include <memory>
#include <set>
#include <sstream>
#include <string>
#include <utility>

#include "geometry/Geometry.h"
#include "geometry/PolySet.h"
#include "geometry/PolySetBuilder.h"
#include "geometry/PolySetUtils.h"
#include "geometry/Polygon2d.h"
#include "geometry/linalg.h"
#include "geometry/manifold/manifoldutils.h"
#include "glview/ColorMap.h"
#include "glview/RenderSettings.h"
#include "utils/printutils.h"
#ifdef ENABLE_CGAL
#include "geometry/cgal/cgalutils.h"
#endif

namespace {

template <typename Result, typename V>
Result vector_convert(V const& v)
{
  return Result(v[0], v[1], v[2]);
}

}  // namespace

ManifoldGeometry::ManifoldGeometry() : manifold_(manifold::Manifold())
{
}

ManifoldGeometry::ManifoldGeometry(manifold::Manifold mani, const std::set<uint32_t>& originalIDs,
                                   const std::map<uint32_t, Color4f>& originalIDToColor,
                                   const std::map<uint32_t, float>& originalIDToRoughness,
                                   const std::map<uint32_t, float>& originalIDToMetalness,
                                   const std::map<uint32_t, float>& originalIDToClearcoat,
                                   const std::map<uint32_t, float>& originalIDToClearcoatRoughness,
                                   const std::map<uint32_t, float>& originalIDToSheen,
                                   const std::map<uint32_t, Color4f>& originalIDToSheenColor,
                                   const std::map<uint32_t, float>& originalIDToSheenRoughness,
                                   const std::set<uint32_t>& subtractedIDs)
  : manifold_(std::move(mani)),
    originalIDs_(originalIDs),
    originalIDToColor_(originalIDToColor),
    originalIDToRoughness_(originalIDToRoughness),
    originalIDToMetalness_(originalIDToMetalness),
    originalIDToClearcoat_(originalIDToClearcoat),
    originalIDToClearcoatRoughness_(originalIDToClearcoatRoughness),
    originalIDToSheen_(originalIDToSheen),
    originalIDToSheenColor_(originalIDToSheenColor),
    originalIDToSheenRoughness_(originalIDToSheenRoughness),
    subtractedIDs_(subtractedIDs)
{
}

std::unique_ptr<Geometry> ManifoldGeometry::copy() const
{
  return std::make_unique<ManifoldGeometry>(*this);
}

const manifold::Manifold& ManifoldGeometry::getManifold() const
{
  return manifold_;
}

bool ManifoldGeometry::isEmpty() const
{
  return getManifold().IsEmpty();
}

size_t ManifoldGeometry::numFacets() const
{
  return getManifold().NumTri();
}

size_t ManifoldGeometry::numVertices() const
{
  return getManifold().NumVert();
}

bool ManifoldGeometry::isManifold() const
{
  return getManifold().Status() == manifold::Manifold::Error::NoError;
}

bool ManifoldGeometry::isValid() const
{
  return manifold_.Status() == manifold::Manifold::Error::NoError;
}

void ManifoldGeometry::clear()
{
  manifold_ = manifold::Manifold();
}

// Note: We promise to only call memsize if we've already evaluated the object.
// However, there is no way of querying this on the Manifold object itself.
size_t ManifoldGeometry::memsize() const
{
  // Estimated memory usage per vertex:
  // - Position: 24 bytes
  // - Halfedges (approx 6 per vert): 6 * 16 = 96 bytes
  // - Normals (vert + 2*face): 24 + 48 = 72 bytes
  // - Mesh Relation (2*face): 32 bytes
  // Total ~ 224 bytes + vector overhead + properties
  return getManifold().NumVert() * 250;
}

std::string ManifoldGeometry::dump() const
{
  std::ostringstream out;
  auto& manifold = getManifold();
  auto meshgl = manifold.GetMeshGL64();
  out << "Manifold:" << "\n status: " << ManifoldUtils::statusToString(manifold.Status())
      << "\n genus: " << manifold.Genus() << "\n num vertices: " << meshgl.NumVert()
      << "\n num polygons: " << meshgl.NumTri() << "\n polygons data:";

  for (size_t faceid = 0; faceid < meshgl.NumTri(); faceid++) {
    out << "\n  polygon begin:";
    for (const int j : {0, 1, 2}) {
      auto v = vector_convert<Vector3d>(meshgl.GetVertPos(meshgl.GetTriVerts(faceid)[j]));
      out << "\n   vertex:" << v;
    }
  }
  out << "Manifold end";
  return out.str();
}

std::shared_ptr<PolySet> ManifoldGeometry::toPolySet() const
{
  manifold::MeshGL64 mesh = getManifold().GetMeshGL64();
  auto ps = std::make_shared<PolySet>(3);
  ps->setTriangular(true);
  ps->vertices.reserve(mesh.NumVert());
  ps->indices.reserve(mesh.NumTri());
  ps->setConvexity(convexity);
  ps->setManifold(true);

  // first 3 channels are xyz coordinate
  for (size_t i = 0; i < mesh.vertProperties.size(); i += mesh.numProp)
    ps->vertices.emplace_back(mesh.vertProperties[i], mesh.vertProperties[i + 1],
                              mesh.vertProperties[i + 2]);

  ps->colors.reserve(originalIDToColor_.size());
  ps->color_indices.reserve(ps->indices.size());

  auto colorScheme = ColorMap::inst()->findColorScheme(RenderSettings::inst()->colorscheme);
  int32_t faceFrontColorIndex = -1;
  int32_t faceBackColorIndex = -1;

  struct MaterialState {
    Color4f color;
    float roughness;
    float metalness;
    float clearcoat;
    float clearcoatRoughness;
    float sheen;
    Color4f sheenColor;
    float sheenRoughness;
    bool operator<(const MaterialState& other) const {
      if (color.r() != other.color.r()) return color.r() < other.color.r();
      if (color.g() != other.color.g()) return color.g() < other.color.g();
      if (color.b() != other.color.b()) return color.b() < other.color.b();
      if (color.a() != other.color.a()) return color.a() < other.color.a();
      if (roughness != other.roughness) return roughness < other.roughness;
      if (metalness != other.metalness) return metalness < other.metalness;
      if (clearcoat != other.clearcoat) return clearcoat < other.clearcoat;
      if (clearcoatRoughness != other.clearcoatRoughness) return clearcoatRoughness < other.clearcoatRoughness;
      if (sheen != other.sheen) return sheen < other.sheen;
      if (sheenColor.r() != other.sheenColor.r()) return sheenColor.r() < other.sheenColor.r();
      if (sheenColor.g() != other.sheenColor.g()) return sheenColor.g() < other.sheenColor.g();
      if (sheenColor.b() != other.sheenColor.b()) return sheenColor.b() < other.sheenColor.b();
      if (sheenColor.a() != other.sheenColor.a()) return sheenColor.a() < other.sheenColor.a();
      return sheenRoughness < other.sheenRoughness;
    }
  };
  std::map<MaterialState, int32_t> materialToIndex;
  std::map<uint32_t, int32_t> originalIDToColorIndex;

  auto getFaceFrontColorIndex = [&]() -> int {
    if (faceFrontColorIndex < 0) {
      faceFrontColorIndex = ps->colors.size();
      ps->colors.push_back(ColorMap::getColor(*colorScheme, RenderColor::CGAL_FACE_FRONT_COLOR));
      ps->roughnesses.push_back(0.0f);
      ps->metalnesses.push_back(0.0f);
      ps->clearcoats.push_back(0.0f);
      ps->clearcoatRoughnesses.push_back(0.0f);
      ps->sheens.push_back(0.0f);
      Vector4f defaultSheen; defaultSheen[0]=0; defaultSheen[1]=0; defaultSheen[2]=0; defaultSheen[3]=1;
      ps->sheenColors.push_back(defaultSheen);
      ps->sheenRoughnesses.push_back(0.0f);
    }
    return faceFrontColorIndex;
  };
  auto getFaceBackColorIndex = [&]() -> int {
    if (faceBackColorIndex < 0) {
      faceBackColorIndex = ps->colors.size();
      ps->colors.push_back(ColorMap::getColor(*colorScheme, RenderColor::CGAL_FACE_BACK_COLOR));
      ps->roughnesses.push_back(0.0f);
      ps->metalnesses.push_back(0.0f);
      ps->clearcoats.push_back(0.0f);
      ps->clearcoatRoughnesses.push_back(0.0f);
      ps->sheens.push_back(0.0f);
      Vector4f defaultSheen; defaultSheen[0]=0; defaultSheen[1]=0; defaultSheen[2]=0; defaultSheen[3]=1;
      ps->sheenColors.push_back(defaultSheen);
      ps->sheenRoughnesses.push_back(0.0f);
    }
    return faceBackColorIndex;
  };

  auto getColorIndex = [&](uint32_t originalID) -> int32_t {
    if (subtractedIDs_.find(originalID) != subtractedIDs_.end()) {
      return getFaceBackColorIndex();
    }
    auto colorIndexIt = originalIDToColorIndex.find(originalID);
    if (colorIndexIt != originalIDToColorIndex.end()) {
      return colorIndexIt->second;
    }
    auto colorIt = originalIDToColor_.find(originalID);
    if (colorIt == originalIDToColor_.end()) {
      return getFaceFrontColorIndex();
    }
    const auto& color = colorIt->second;
    float roughness = 0.0f;
    auto roughIt = originalIDToRoughness_.find(originalID);
    if (roughIt != originalIDToRoughness_.end()) roughness = roughIt->second;

    float metalness = 0.0f;
    auto metalIt = originalIDToMetalness_.find(originalID);
    if (metalIt != originalIDToMetalness_.end()) metalness = metalIt->second;

    float clearcoat = 0.0f;
    auto ccIt = originalIDToClearcoat_.find(originalID);
    if (ccIt != originalIDToClearcoat_.end()) clearcoat = ccIt->second;

    float clearcoatRoughness = 0.0f;
    auto ccrIt = originalIDToClearcoatRoughness_.find(originalID);
    if (ccrIt != originalIDToClearcoatRoughness_.end()) clearcoatRoughness = ccrIt->second;

    float sheen = 0.0f;
    auto sheenIt = originalIDToSheen_.find(originalID);
    if (sheenIt != originalIDToSheen_.end()) sheen = sheenIt->second;

    Color4f sheenColor;
    Vector4f defSheenColor; defSheenColor[0]=0; defSheenColor[1]=0; defSheenColor[2]=0; defSheenColor[3]=1;
    sheenColor = defSheenColor;
    auto sheenColorIt = originalIDToSheenColor_.find(originalID);
    if (sheenColorIt != originalIDToSheenColor_.end()) sheenColor = sheenColorIt->second;

    float sheenRoughness = 0.0f;
    auto sheenRoughIt = originalIDToSheenRoughness_.find(originalID);
    if (sheenRoughIt != originalIDToSheenRoughness_.end()) sheenRoughness = sheenRoughIt->second;

    auto matIt = materialToIndex.lower_bound({color, roughness, metalness, clearcoat, clearcoatRoughness, sheen, sheenColor, sheenRoughness});
    bool match = false;
    if (matIt != materialToIndex.end()) {
      const auto& c1 = matIt->first.color;
      const auto& c2 = color;
      match = (c1.r() == c2.r() && c1.g() == c2.g() && c1.b() == c2.b() && c1.a() == c2.a() &&
               matIt->first.roughness == roughness && matIt->first.metalness == metalness &&
               matIt->first.clearcoat == clearcoat && matIt->first.clearcoatRoughness == clearcoatRoughness &&
               matIt->first.sheen == sheen &&
               matIt->first.sheenColor.r() == sheenColor.r() && matIt->first.sheenColor.g() == sheenColor.g() &&
               matIt->first.sheenColor.b() == sheenColor.b() && matIt->first.sheenColor.a() == sheenColor.a() &&
               matIt->first.sheenRoughness == sheenRoughness);
    }

    if (match) {
      originalIDToColorIndex[originalID] = matIt->second;
      return matIt->second;
    } else {
      int32_t color_index = ps->colors.size();
      ps->colors.push_back(color);
      ps->roughnesses.push_back(roughness);
      ps->metalnesses.push_back(metalness);
      ps->clearcoats.push_back(clearcoat);
      ps->clearcoatRoughnesses.push_back(clearcoatRoughness);
      ps->sheens.push_back(sheen);
      ps->sheenColors.push_back(sheenColor);
      ps->sheenRoughnesses.push_back(sheenRoughness);
      materialToIndex.insert(matIt, {{color, roughness, metalness, clearcoat, clearcoatRoughness, sheen, sheenColor, sheenRoughness}, color_index});
      originalIDToColorIndex[originalID] = color_index;
      return color_index;
    }
  };

  auto start = mesh.runIndex[0];
  for (int run = 0, numRun = mesh.runIndex.size() - 1; run < numRun; ++run) {
    const auto id = mesh.runOriginalID[run];
    const auto end = mesh.runIndex[run + 1];
    const size_t numTri = (end - start) / 3;
    if (numTri == 0) {
      continue;
    }

    auto colorIndex = getColorIndex(id);
    for (size_t i = start; i < end; i += 3) {
      ps->indices.push_back({static_cast<int>(mesh.triVerts[i]), static_cast<int>(mesh.triVerts[i + 1]),
                             static_cast<int>(mesh.triVerts[i + 2])});
      ps->color_indices.push_back(colorIndex);
    }
    start = end;
  }
  return ps;
}

#ifdef ENABLE_CGAL
template <typename Polyhedron>
class CGALPolyhedronBuilderFromManifold : public CGAL::Modifier_base<typename Polyhedron::HalfedgeDS>
{
  using HDS = typename Polyhedron::HalfedgeDS;
  using CGAL_Polybuilder = CGAL::Polyhedron_incremental_builder_3<typename Polyhedron::HalfedgeDS>;

public:
  using CGALPoint = typename CGAL_Polybuilder::Point_3;

  const manifold::MeshGL64& meshgl;
  CGALPolyhedronBuilderFromManifold(const manifold::MeshGL64& mesh) : meshgl(mesh) {}

  void operator()(HDS& hds) override
  {
    CGAL_Polybuilder B(hds, true);

    B.begin_surface(meshgl.NumVert(), meshgl.NumTri());
    for (size_t vertid = 0; vertid < meshgl.NumVert(); vertid++)
      B.add_vertex(CGALUtils::vector_convert<CGALPoint>(meshgl.GetVertPos(vertid)));

    for (size_t faceid = 0; faceid < meshgl.NumTri(); faceid++) {
      const auto tv = meshgl.GetTriVerts(faceid);
      B.begin_facet();
      for (const int j : {0, 1, 2}) {
        B.add_vertex_to_facet(tv[j]);
      }
      B.end_facet();
    }
    B.end_surface();
  }
};

template <class Polyhedron>
std::shared_ptr<Polyhedron> ManifoldGeometry::toPolyhedron() const
{
  auto p = std::make_shared<Polyhedron>();
  try {
    auto meshgl = getManifold().GetMeshGL64();
    CGALPolyhedronBuilderFromManifold<Polyhedron> builder(meshgl);
    p->delegate(builder);
  } catch (const CGAL::Assertion_exception& e) {
    LOG(message_group::Error, "CGAL error in ManifoldGeometry::toPolyhedron(): %1$s", e.what());
  }
  return p;
}

template std::shared_ptr<CGAL::Polyhedron_3<CGAL_Kernel3>> ManifoldGeometry::toPolyhedron() const;

#endif

ManifoldGeometry ManifoldGeometry::binOp(const ManifoldGeometry& lhs, const ManifoldGeometry& rhs,
                                         manifold::OpType opType) const
{
  auto mani = lhs.manifold_.Boolean(rhs.manifold_, opType);
  auto originalIDToColor = lhs.originalIDToColor_;
  auto originalIDToRoughness = lhs.originalIDToRoughness_;
  auto originalIDToMetalness = lhs.originalIDToMetalness_;
  auto originalIDToClearcoat = lhs.originalIDToClearcoat_;
  auto originalIDToClearcoatRoughness = lhs.originalIDToClearcoatRoughness_;
  auto originalIDToSheen = lhs.originalIDToSheen_;
  auto originalIDToSheenColor = lhs.originalIDToSheenColor_;
  auto originalIDToSheenRoughness = lhs.originalIDToSheenRoughness_;
  auto subtractedIDs = lhs.subtractedIDs_;

  auto originalIDs = lhs.originalIDs_;
  originalIDs.insert(rhs.originalIDs_.begin(), rhs.originalIDs_.end());

  if (opType == manifold::OpType::Subtract) {
    // Mark all the original ids coming from rhs as subtracted, unless they're mapped to a color.
    for (const auto id : rhs.originalIDs_) {
      auto it = rhs.originalIDToColor_.find(id);
      if (it != rhs.originalIDToColor_.end()) {
        originalIDToColor[id] = it->second;
        auto rit = rhs.originalIDToRoughness_.find(id);
        originalIDToRoughness[id] = rit != rhs.originalIDToRoughness_.end() ? rit->second : 0.0f;
        auto mit = rhs.originalIDToMetalness_.find(id);
        originalIDToMetalness[id] = mit != rhs.originalIDToMetalness_.end() ? mit->second : 0.0f;
        auto ccit = rhs.originalIDToClearcoat_.find(id);
        originalIDToClearcoat[id] = ccit != rhs.originalIDToClearcoat_.end() ? ccit->second : 0.0f;
        auto ccrit = rhs.originalIDToClearcoatRoughness_.find(id);
        originalIDToClearcoatRoughness[id] = ccrit != rhs.originalIDToClearcoatRoughness_.end() ? ccrit->second : 0.0f;
        auto sit = rhs.originalIDToSheen_.find(id);
        originalIDToSheen[id] = sit != rhs.originalIDToSheen_.end() ? sit->second : 0.0f;
        auto scit = rhs.originalIDToSheenColor_.find(id);
        if (scit != rhs.originalIDToSheenColor_.end()) {
          originalIDToSheenColor[id] = scit->second;
        } else {
          Vector4f defSheenColor; defSheenColor[0]=0; defSheenColor[1]=0; defSheenColor[2]=0; defSheenColor[3]=1;
          originalIDToSheenColor[id] = defSheenColor;
        }
        auto srit = rhs.originalIDToSheenRoughness_.find(id);
        originalIDToSheenRoughness[id] = srit != rhs.originalIDToSheenRoughness_.end() ? srit->second : 0.0f;
      } else {
        subtractedIDs.insert(id);
      }
    }
  } else {
    // Add the id -> color mapping from the rhs.
    originalIDToColor.insert(rhs.originalIDToColor_.begin(), rhs.originalIDToColor_.end());
    originalIDToRoughness.insert(rhs.originalIDToRoughness_.begin(), rhs.originalIDToRoughness_.end());
    originalIDToMetalness.insert(rhs.originalIDToMetalness_.begin(), rhs.originalIDToMetalness_.end());
    originalIDToClearcoat.insert(rhs.originalIDToClearcoat_.begin(), rhs.originalIDToClearcoat_.end());
    originalIDToClearcoatRoughness.insert(rhs.originalIDToClearcoatRoughness_.begin(), rhs.originalIDToClearcoatRoughness_.end());
    originalIDToSheen.insert(rhs.originalIDToSheen_.begin(), rhs.originalIDToSheen_.end());
    originalIDToSheenColor.insert(rhs.originalIDToSheenColor_.begin(), rhs.originalIDToSheenColor_.end());
    originalIDToSheenRoughness.insert(rhs.originalIDToSheenRoughness_.begin(), rhs.originalIDToSheenRoughness_.end());
    subtractedIDs.insert(rhs.subtractedIDs_.begin(), rhs.subtractedIDs_.end());
  }
  return {mani, originalIDs, originalIDToColor, originalIDToRoughness, originalIDToMetalness, originalIDToClearcoat, originalIDToClearcoatRoughness, originalIDToSheen, originalIDToSheenColor, originalIDToSheenRoughness, subtractedIDs};
}

std::shared_ptr<ManifoldGeometry> minkowskiOp(const ManifoldGeometry& lhs, const ManifoldGeometry& rhs)
{
// FIXME: How to deal with operation not supported?
#ifdef ENABLE_CGAL
  auto lhs_nef =
    std::shared_ptr<CGALNefGeometry>(CGALUtils::createNefPolyhedronFromPolySet(*lhs.toPolySet()));
  auto rhs_nef =
    std::shared_ptr<CGALNefGeometry>(CGALUtils::createNefPolyhedronFromPolySet(*rhs.toPolySet()));
  if (lhs_nef->isEmpty() || rhs_nef->isEmpty()) {
    return {};
  }
  std::shared_ptr<const PolySet> ps;
  try {
    lhs_nef->minkowski(*rhs_nef);
    ps = PolySetUtils::getGeometryAsPolySet(lhs_nef);
    if (ps) {
      return ManifoldUtils::createManifoldFromPolySet(*ps);
    }
  } catch (const std::exception& e) {
    LOG(message_group::Error, "Nef minkoswki operation failed: %1$s\n", e.what());
  } catch (...) {
    LOG(message_group::Warning, "Nef minkowski hard-crashed");
  }
#endif
  return {};
}

ManifoldGeometry ManifoldGeometry::operator+(const ManifoldGeometry& other) const
{
  return binOp(*this, other, manifold::OpType::Add);
}

ManifoldGeometry ManifoldGeometry::operator*(const ManifoldGeometry& other) const
{
  return binOp(*this, other, manifold::OpType::Intersect);
}

ManifoldGeometry ManifoldGeometry::operator-(const ManifoldGeometry& other) const
{
  return binOp(*this, other, manifold::OpType::Subtract);
}

ManifoldGeometry ManifoldGeometry::minkowski(const ManifoldGeometry& other) const
{
#if defined(USE_MANIFOLD_MINKOWSKI)
  auto result = getManifold().MinkowskiSum(other.getManifold());
  std::set<uint32_t> originalIDs;
  auto id = result.OriginalID();
  if (id >= 0) {
    originalIDs.insert(id);
  }
  return {result, originalIDs};
#else
  std::shared_ptr<ManifoldGeometry> geom = minkowskiOp(*this, other);
  if (geom) return *geom;
  else return {};
#endif
}

Polygon2d ManifoldGeometry::slice() const
{
  auto cross_section = manifold::CrossSection(manifold_.Slice());
  return ManifoldUtils::polygonsToPolygon2d(cross_section.ToPolygons());
}

Polygon2d ManifoldGeometry::project() const
{
  auto cross_section = manifold::CrossSection(manifold_.Project());
  return ManifoldUtils::polygonsToPolygon2d(cross_section.ToPolygons());
}

void ManifoldGeometry::transform(const Transform3d& mat)
{
  manifold::mat3x4 glMat(
    // Column-major ordering
    {mat(0, 0), mat(1, 0), mat(2, 0)}, {mat(0, 1), mat(1, 1), mat(2, 1)},
    {mat(0, 2), mat(1, 2), mat(2, 2)}, {mat(0, 3), mat(1, 3), mat(2, 3)});
  manifold_ = getManifold().Transform(glMat);
}

void ManifoldGeometry::setColor(const Color4f& c, float roughness, float metalness, float clearcoat, float clearcoatRoughness, float sheen, const Color4f& sheenColor, float sheenRoughness)
{
  if (manifold_.OriginalID() == -1) {
    manifold_ = manifold_.AsOriginal();
  }
  originalIDs_.clear();
  originalIDs_.insert(manifold_.OriginalID());
  originalIDToColor_.clear();
  originalIDToColor_[manifold_.OriginalID()] = c;
  originalIDToRoughness_.clear();
  originalIDToRoughness_[manifold_.OriginalID()] = roughness;
  originalIDToMetalness_.clear();
  originalIDToMetalness_[manifold_.OriginalID()] = metalness;
  originalIDToClearcoat_.clear();
  originalIDToClearcoat_[manifold_.OriginalID()] = clearcoat;
  originalIDToClearcoatRoughness_.clear();
  originalIDToClearcoatRoughness_[manifold_.OriginalID()] = clearcoatRoughness;
  originalIDToSheen_.clear();
  originalIDToSheen_[manifold_.OriginalID()] = sheen;
  originalIDToSheenColor_.clear();
  originalIDToSheenColor_[manifold_.OriginalID()] = sheenColor;
  originalIDToSheenRoughness_.clear();
  originalIDToSheenRoughness_[manifold_.OriginalID()] = sheenRoughness;
  subtractedIDs_.clear();
}

void ManifoldGeometry::toOriginal()
{
  if (manifold_.OriginalID() == -1) {
    manifold_ = manifold_.AsOriginal();
  }
  originalIDs_.clear();
  originalIDs_.insert(manifold_.OriginalID());
  originalIDToColor_.clear();
  originalIDToRoughness_.clear();
  originalIDToMetalness_.clear();
  originalIDToClearcoat_.clear();
  originalIDToClearcoatRoughness_.clear();
  originalIDToSheen_.clear();
  originalIDToSheenColor_.clear();
  originalIDToSheenRoughness_.clear();
  subtractedIDs_.clear();
}

BoundingBox ManifoldGeometry::getBoundingBox() const
{
  BoundingBox result;
  manifold::Box bbox = getManifold().BoundingBox();
  result.extend(vector_convert<Eigen::Vector3d>(bbox.min));
  result.extend(vector_convert<Eigen::Vector3d>(bbox.max));
  return result;
}

void ManifoldGeometry::resize(const Vector3d& newsize, const Eigen::Matrix<bool, 3, 1>& autosize)
{
  transform(GeometryUtils::getResizeTransform(this->getBoundingBox(), newsize, autosize));
}

/*! Iterate over all vertices' points until the function returns true (for done). */
void ManifoldGeometry::foreachVertexUntilTrue(
  const std::function<bool(const manifold::vec3& pt)>& f) const
{
  auto mesh = getManifold().GetMeshGL64();
  const auto numVert = mesh.NumVert();
  for (size_t v = 0; v < numVert; ++v) {
    if (f(mesh.GetVertPos(v))) {
      return;
    }
  }
}
