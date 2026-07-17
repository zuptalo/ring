#!/usr/bin/env bash

set -e

JSON_MODE=false
DRY_RUN=false
ALLOW_EXISTING=false
SHORT_NAME=""
BRANCH_NUMBER=""
USE_TIMESTAMP=false
CATEGORY=""
ARGS=()
i=1
while [ $i -le $# ]; do
    arg="${!i}"
    case "$arg" in
        --json)
            JSON_MODE=true
            ;;
        --dry-run)
            DRY_RUN=true
            ;;
        --allow-existing-branch)
            ALLOW_EXISTING=true
            ;;
        --short-name)
            if [ $((i + 1)) -gt $# ]; then
                echo 'Error: --short-name requires a value' >&2
                exit 1
            fi
            i=$((i + 1))
            next_arg="${!i}"
            # Check if the next argument is another option (starts with --)
            if [[ "$next_arg" == --* ]]; then
                echo 'Error: --short-name requires a value' >&2
                exit 1
            fi
            SHORT_NAME="$next_arg"
            ;;
        --number)
            if [ $((i + 1)) -gt $# ]; then
                echo 'Error: --number requires a value' >&2
                exit 1
            fi
            i=$((i + 1))
            next_arg="${!i}"
            if [[ "$next_arg" == --* ]]; then
                echo 'Error: --number requires a value' >&2
                exit 1
            fi
            BRANCH_NUMBER="$next_arg"
            ;;
        --timestamp)
            USE_TIMESTAMP=true
            ;;
        --category)
            if [ $((i + 1)) -gt $# ]; then
                echo 'Error: --category requires a value' >&2
                exit 1
            fi
            i=$((i + 1))
            next_arg="${!i}"
            if [[ "$next_arg" == --* ]]; then
                echo 'Error: --category requires a value' >&2
                exit 1
            fi
            CATEGORY="$next_arg"
            ;;
        --help|-h)
            echo "Usage: $0 [--json] [--dry-run] [--allow-existing-branch] [--short-name <name>] [--number N] [--timestamp] [--category <planned|adhoc|hotfix>] <feature_description>"
            echo ""
            echo "Options:"
            echo "  --json              Output in JSON format"
            echo "  --dry-run           Compute branch name and paths without creating branches, directories, or files"
            echo "  --allow-existing-branch  Switch to branch if it already exists instead of failing"
            echo "  --short-name <name> Provide a custom short name (2-4 words) for the branch"
            echo "  --number N          Specify branch number manually (overrides auto-detection)"
            echo "  --timestamp         Use timestamp prefix (YYYYMMDD-HHMMSS) instead of sequential numbering"
            echo "  --category <c>      Ring spec band: planned (0001+), adhoc (1001+), hotfix (2001+)."
            echo "                      Allocates the next free 4-digit number within that band."
            echo "  --help, -h          Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0 'Add user authentication system' --short-name 'user-auth'"
            echo "  $0 'Implement OAuth2 integration for API' --number 5"
            echo "  $0 --timestamp --short-name 'user-auth' 'Add user authentication'"
            exit 0
            ;;
        *)
            ARGS+=("$arg")
            ;;
    esac
    i=$((i + 1))
done

FEATURE_DESCRIPTION="${ARGS[*]}"
if [ -z "$FEATURE_DESCRIPTION" ]; then
    echo "Usage: $0 [--json] [--dry-run] [--allow-existing-branch] [--short-name <name>] [--number N] [--timestamp] <feature_description>" >&2
    exit 1
fi

# Trim whitespace and validate description is not empty (e.g., user passed only whitespace)
FEATURE_DESCRIPTION=$(echo "$FEATURE_DESCRIPTION" | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')
if [ -z "$FEATURE_DESCRIPTION" ]; then
    echo "Error: Feature description cannot be empty or contain only whitespace" >&2
    exit 1
fi

# Function to get highest number from specs directory
get_highest_from_specs() {
    local specs_dir="$1"
    local highest=0
    
    if [ -d "$specs_dir" ]; then
        for dir in "$specs_dir"/*; do
            [ -d "$dir" ] || continue
            dirname=$(basename "$dir")
            # Match sequential prefixes (>=3 digits), but skip timestamp dirs.
            if echo "$dirname" | grep -Eq '^[0-9]{3,}-' && ! echo "$dirname" | grep -Eq '^[0-9]{8}-[0-9]{6}-'; then
                number=$(echo "$dirname" | grep -Eo '^[0-9]+')
                number=$((10#$number))
                if [ "$number" -gt "$highest" ]; then
                    highest=$number
                fi
            fi
        done
    fi
    
    echo "$highest"
}

# Function to get highest number from git branches
get_highest_from_branches() {
    git branch -a 2>/dev/null | sed 's/^[* ]*//; s|^remotes/[^/]*/||' | _extract_highest_number
}

# Extract the highest sequential feature number from a list of ref names (one per line).
# Shared by get_highest_from_branches and get_highest_from_remote_refs.
_extract_highest_number() {
    local highest=0
    while IFS= read -r name; do
        [ -z "$name" ] && continue
        if echo "$name" | grep -Eq '^[0-9]{3,}-' && ! echo "$name" | grep -Eq '^[0-9]{8}-[0-9]{6}-'; then
            number=$(echo "$name" | grep -Eo '^[0-9]+' || echo "0")
            number=$((10#$number))
            if [ "$number" -gt "$highest" ]; then
                highest=$number
            fi
        fi
    done
    echo "$highest"
}

# Function to get highest number from remote branches without fetching (side-effect-free)
get_highest_from_remote_refs() {
    local highest=0

    for remote in $(git remote 2>/dev/null); do
        local remote_highest
        remote_highest=$(GIT_TERMINAL_PROMPT=0 git ls-remote --heads "$remote" 2>/dev/null | sed 's|.*refs/heads/||' | _extract_highest_number)
        if [ "$remote_highest" -gt "$highest" ]; then
            highest=$remote_highest
        fi
    done

    echo "$highest"
}

# Function to check existing branches (local and remote) and return next available number.
# When skip_fetch is true, queries remotes via ls-remote (read-only) instead of fetching.
check_existing_branches() {
    local specs_dir="$1"
    local skip_fetch="${2:-false}"

    if [ "$skip_fetch" = true ]; then
        # Side-effect-free: query remotes via ls-remote
        local highest_remote=$(get_highest_from_remote_refs)
        local highest_branch=$(get_highest_from_branches)
        if [ "$highest_remote" -gt "$highest_branch" ]; then
            highest_branch=$highest_remote
        fi
    else
        # Fetch all remotes to get latest branch info (suppress errors if no remotes)
        git fetch --all --prune >/dev/null 2>&1 || true
        local highest_branch=$(get_highest_from_branches)
    fi

    # Get highest number from ALL specs (not just matching short name)
    local highest_spec=$(get_highest_from_specs "$specs_dir")

    # Take the maximum of both
    local max_num=$highest_branch
    if [ "$highest_spec" -gt "$max_num" ]; then
        max_num=$highest_spec
    fi

    # Return next number
    echo $((max_num + 1))
}

# --- Ring category bands -----------------------------------------------------
# Ring partitions spec numbers by category so the number itself signals intent:
#   planned features 0001-0999, ad-hoc work 1001-1999, hotfixes/bugs 2001+.
# This keeps the existing speckit branch-resolution machinery intact (branches
# stay "NNNN-slug" with no type prefix) while letting ROADMAP.md group by band.

# Echo "<base> <ceil>" for a category, or empty string if the category is unknown.
band_range() {
    case "$1" in
        planned) echo "1 999" ;;
        adhoc)   echo "1001 1999" ;;
        hotfix)  echo "2001 9999999" ;;
        *)       echo "" ;;
    esac
}

# Compute the next free number within [base, ceil], scanning both existing spec
# directories and local/remote git branches. Mirrors the band-agnostic helpers
# above but filters to the requested range. A leading "type/" segment on a branch
# (e.g. a stray "feat/0004-x") is stripped before the number is read.
next_number_in_band() {
    local base="$1" ceil="$2"
    local highest=$((base - 1))
    local names=""

    if [ -d "$SPECS_DIR" ]; then
        for dir in "$SPECS_DIR"/*; do
            [ -d "$dir" ] || continue
            names+="$(basename "$dir")"$'\n'
        done
    fi

    if [ "$HAS_GIT" = true ]; then
        names+="$(git branch -a 2>/dev/null | sed 's/^[* ]*//; s|^remotes/[^/]*/||')"$'\n'
        for remote in $(git remote 2>/dev/null); do
            names+="$(GIT_TERMINAL_PROMPT=0 git ls-remote --heads "$remote" 2>/dev/null | sed 's|.*refs/heads/||')"$'\n'
        done
    fi

    while IFS= read -r name; do
        [ -z "$name" ] && continue
        name="${name##*/}"                                   # strip optional type/ prefix
        echo "$name" | grep -Eq '^[0-9]{3,}-' || continue
        echo "$name" | grep -Eq '^[0-9]{8}-[0-9]{6}-' && continue  # skip timestamp dirs
        local n
        n=$(echo "$name" | grep -Eo '^[0-9]+')
        n=$((10#$n))
        if [ "$n" -ge "$base" ] && [ "$n" -le "$ceil" ] && [ "$n" -gt "$highest" ]; then
            highest=$n
        fi
    done <<< "$names"

    echo $((highest + 1))
}

# Function to clean and format a branch name
clean_branch_name() {
    local name="$1"
    echo "$name" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/-\+/-/g' | sed 's/^-//' | sed 's/-$//'
}

# Resolve repository root using common.sh functions which prioritize .specify over git
SCRIPT_DIR="$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

REPO_ROOT=$(get_repo_root)

# Check if git is available at this repo root (not a parent)
if has_git; then
    HAS_GIT=true
else
    HAS_GIT=false
fi

cd "$REPO_ROOT"

SPECS_DIR="$REPO_ROOT/specs"
if [ "$DRY_RUN" != true ]; then
    mkdir -p "$SPECS_DIR"
fi

# Function to generate branch name with stop word filtering and length filtering
generate_branch_name() {
    local description="$1"
    
    # Common stop words to filter out
    local stop_words="^(i|a|an|the|to|for|of|in|on|at|by|with|from|is|are|was|were|be|been|being|have|has|had|do|does|did|will|would|should|could|can|may|might|must|shall|this|that|these|those|my|your|our|their|want|need|add|get|set)$"
    
    # Convert to lowercase and split into words
    local clean_name=$(echo "$description" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/ /g')
    
    # Filter words: remove stop words and words shorter than 3 chars (unless they're uppercase acronyms in original)
    local meaningful_words=()
    for word in $clean_name; do
        # Skip empty words
        [ -z "$word" ] && continue
        
        # Keep words that are NOT stop words AND (length >= 3 OR are potential acronyms)
        if ! echo "$word" | grep -qiE "$stop_words"; then
            if [ ${#word} -ge 3 ]; then
                meaningful_words+=("$word")
            elif echo "$description" | grep -q "\b${word^^}\b"; then
                # Keep short words if they appear as uppercase in original (likely acronyms)
                meaningful_words+=("$word")
            fi
        fi
    done
    
    # If we have meaningful words, use first 3-4 of them
    if [ ${#meaningful_words[@]} -gt 0 ]; then
        local max_words=3
        if [ ${#meaningful_words[@]} -eq 4 ]; then max_words=4; fi
        
        local result=""
        local count=0
        for word in "${meaningful_words[@]}"; do
            if [ $count -ge $max_words ]; then break; fi
            if [ -n "$result" ]; then result="$result-"; fi
            result="$result$word"
            count=$((count + 1))
        done
        echo "$result"
    else
        # Fallback to original logic if no meaningful words found
        local cleaned=$(clean_branch_name "$description")
        echo "$cleaned" | tr '-' '\n' | grep -v '^$' | head -3 | tr '\n' '-' | sed 's/-$//'
    fi
}

# Generate branch name
if [ -n "$SHORT_NAME" ]; then
    # Use provided short name, just clean it up
    BRANCH_SUFFIX=$(clean_branch_name "$SHORT_NAME")
else
    # Generate from description with smart filtering
    BRANCH_SUFFIX=$(generate_branch_name "$FEATURE_DESCRIPTION")
fi

# Warn if --number and --timestamp are both specified
if [ "$USE_TIMESTAMP" = true ] && [ -n "$BRANCH_NUMBER" ]; then
    >&2 echo "[specify] Warning: --number is ignored when --timestamp is used"
    BRANCH_NUMBER=""
fi

# Validate --category and (when no explicit number/timestamp) allocate the next
# free number within its band. Padding widens to 4 digits so planned specs read
# as 0001 and never collide visually with the 1001/2001 bands.
NUM_PAD=3
TYPE_PREFIX=""
if [ -n "$CATEGORY" ]; then
    BAND=$(band_range "$CATEGORY")
    if [ -z "$BAND" ]; then
        echo "Error: unknown --category '$CATEGORY' (expected planned|adhoc|hotfix)" >&2
        exit 1
    fi
    NUM_PAD=4
    # GitFlow branch type: features (planned + ad-hoc) ride feat/, hotfixes ride
    # fix/. The spec DIRECTORY stays flat ("NNNN-slug") — only the branch carries
    # the prefix — so speckit's specs/* scanners and the ROADMAP generator (which
    # both read one directory level) keep working unchanged.
    case "$CATEGORY" in
        hotfix) TYPE_PREFIX="fix" ;;
        *)      TYPE_PREFIX="feat" ;;
    esac
    if [ "$USE_TIMESTAMP" = true ]; then
        >&2 echo "[specify] Warning: --category is ignored when --timestamp is used"
        TYPE_PREFIX=""
    elif [ -z "$BRANCH_NUMBER" ]; then
        BAND_BASE=${BAND% *}
        BAND_CEIL=${BAND#* }
        BRANCH_NUMBER=$(next_number_in_band "$BAND_BASE" "$BAND_CEIL")
        if [ "$BRANCH_NUMBER" -gt "$BAND_CEIL" ]; then
            echo "Error: spec band '$CATEGORY' is exhausted (next $BRANCH_NUMBER exceeds ceiling $BAND_CEIL)" >&2
            exit 1
        fi
    fi
fi

# Determine the flat spec directory name ("<num>-<slug>") and the branch name
# (the directory name, optionally under a GitFlow type prefix like "feat/").
BRANCH_PREFIX=""
if [ "$USE_TIMESTAMP" = true ]; then
    FEATURE_NUM=$(date +%Y%m%d-%H%M%S)
    DIR_NAME="${FEATURE_NUM}-${BRANCH_SUFFIX}"
else
    # Determine branch number
    if [ -z "$BRANCH_NUMBER" ]; then
        if [ "$DRY_RUN" = true ] && [ "$HAS_GIT" = true ]; then
            # Dry-run: query remotes via ls-remote (side-effect-free, no fetch)
            BRANCH_NUMBER=$(check_existing_branches "$SPECS_DIR" true)
        elif [ "$DRY_RUN" = true ]; then
            # Dry-run without git: local spec dirs only
            HIGHEST=$(get_highest_from_specs "$SPECS_DIR")
            BRANCH_NUMBER=$((HIGHEST + 1))
        elif [ "$HAS_GIT" = true ]; then
            # Check existing branches on remotes
            BRANCH_NUMBER=$(check_existing_branches "$SPECS_DIR")
        else
            # Fall back to local directory check
            HIGHEST=$(get_highest_from_specs "$SPECS_DIR")
            BRANCH_NUMBER=$((HIGHEST + 1))
        fi
    fi

    # Force base-10 interpretation to prevent octal conversion (e.g., 010 → 8 in octal, but should be 10 in decimal)
    FEATURE_NUM=$(printf "%0${NUM_PAD}d" "$((10#$BRANCH_NUMBER))")
    DIR_NAME="${FEATURE_NUM}-${BRANCH_SUFFIX}"
    [ -n "$TYPE_PREFIX" ] && BRANCH_PREFIX="${TYPE_PREFIX}/"
fi
BRANCH_NAME="${BRANCH_PREFIX}${DIR_NAME}"

# GitHub enforces a 244-byte limit on branch names
# Validate and truncate if necessary
MAX_BRANCH_LENGTH=244
if [ ${#BRANCH_NAME} -gt $MAX_BRANCH_LENGTH ]; then
    # Calculate how much we need to trim from suffix. Reserve room for the type
    # prefix (e.g. "feat/"), the number, and the hyphen.
    PREFIX_LENGTH=$(( ${#BRANCH_PREFIX} + ${#FEATURE_NUM} + 1 ))
    MAX_SUFFIX_LENGTH=$((MAX_BRANCH_LENGTH - PREFIX_LENGTH))

    # Truncate suffix at word boundary if possible
    TRUNCATED_SUFFIX=$(echo "$BRANCH_SUFFIX" | cut -c1-$MAX_SUFFIX_LENGTH)
    # Remove trailing hyphen if truncation created one
    TRUNCATED_SUFFIX=$(echo "$TRUNCATED_SUFFIX" | sed 's/-$//')

    ORIGINAL_BRANCH_NAME="$BRANCH_NAME"
    DIR_NAME="${FEATURE_NUM}-${TRUNCATED_SUFFIX}"
    BRANCH_NAME="${BRANCH_PREFIX}${DIR_NAME}"

    >&2 echo "[specify] Warning: Branch name exceeded GitHub's 244-byte limit"
    >&2 echo "[specify] Original: $ORIGINAL_BRANCH_NAME (${#ORIGINAL_BRANCH_NAME} bytes)"
    >&2 echo "[specify] Truncated to: $BRANCH_NAME (${#BRANCH_NAME} bytes)"
fi

# The spec directory is always the flat (un-prefixed) DIR_NAME so speckit's
# specs/* resolution stays prefix-agnostic; the branch may carry a type prefix.
FEATURE_DIR="$SPECS_DIR/$DIR_NAME"
SPEC_FILE="$FEATURE_DIR/spec.md"

if [ "$DRY_RUN" != true ]; then
    if [ "$HAS_GIT" = true ]; then
        branch_create_error=""
        if ! branch_create_error=$(git checkout -q -b "$BRANCH_NAME" 2>&1); then
            current_branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
            # Check if branch already exists
            if git branch --list "$BRANCH_NAME" | grep -q .; then
                if [ "$ALLOW_EXISTING" = true ]; then
                    # If we're already on the branch, continue without another checkout.
                    if [ "$current_branch" = "$BRANCH_NAME" ]; then
                        :
                    # Otherwise switch to the existing branch instead of failing.
                    elif ! switch_branch_error=$(git checkout -q "$BRANCH_NAME" 2>&1); then
                        >&2 echo "Error: Failed to switch to existing branch '$BRANCH_NAME'. Please resolve any local changes or conflicts and try again."
                        if [ -n "$switch_branch_error" ]; then
                            >&2 printf '%s\n' "$switch_branch_error"
                        fi
                        exit 1
                    fi
                elif [ "$USE_TIMESTAMP" = true ]; then
                    >&2 echo "Error: Branch '$BRANCH_NAME' already exists. Rerun to get a new timestamp or use a different --short-name."
                    exit 1
                else
                    >&2 echo "Error: Branch '$BRANCH_NAME' already exists. Please use a different feature name or specify a different number with --number."
                    exit 1
                fi
            else
                >&2 echo "Error: Failed to create git branch '$BRANCH_NAME'."
                if [ -n "$branch_create_error" ]; then
                    >&2 printf '%s\n' "$branch_create_error"
                else
                    >&2 echo "Please check your git configuration and try again."
                fi
                exit 1
            fi
        fi
    else
        >&2 echo "[specify] Warning: Git repository not detected; skipped branch creation for $BRANCH_NAME"
    fi

    mkdir -p "$FEATURE_DIR"

    if [ ! -f "$SPEC_FILE" ]; then
        TEMPLATE=$(resolve_template "spec-template" "$REPO_ROOT") || true
        if [ -n "$TEMPLATE" ] && [ -f "$TEMPLATE" ]; then
            cp "$TEMPLATE" "$SPEC_FILE"
        else
            echo "Warning: Spec template not found; created empty spec file" >&2
            touch "$SPEC_FILE"
        fi
    fi

    # Inform the user how to persist the feature variable in their own shell
    printf '# To persist: export SPECIFY_FEATURE=%q\n' "$BRANCH_NAME" >&2
fi

if $JSON_MODE; then
    if command -v jq >/dev/null 2>&1; then
        if [ "$DRY_RUN" = true ]; then
            jq -cn \
                --arg branch_name "$BRANCH_NAME" \
                --arg spec_file "$SPEC_FILE" \
                --arg feature_num "$FEATURE_NUM" \
                '{BRANCH_NAME:$branch_name,SPEC_FILE:$spec_file,FEATURE_NUM:$feature_num,DRY_RUN:true}'
        else
            jq -cn \
                --arg branch_name "$BRANCH_NAME" \
                --arg spec_file "$SPEC_FILE" \
                --arg feature_num "$FEATURE_NUM" \
                '{BRANCH_NAME:$branch_name,SPEC_FILE:$spec_file,FEATURE_NUM:$feature_num}'
        fi
    else
        if [ "$DRY_RUN" = true ]; then
            printf '{"BRANCH_NAME":"%s","SPEC_FILE":"%s","FEATURE_NUM":"%s","DRY_RUN":true}\n' "$(json_escape "$BRANCH_NAME")" "$(json_escape "$SPEC_FILE")" "$(json_escape "$FEATURE_NUM")"
        else
            printf '{"BRANCH_NAME":"%s","SPEC_FILE":"%s","FEATURE_NUM":"%s"}\n' "$(json_escape "$BRANCH_NAME")" "$(json_escape "$SPEC_FILE")" "$(json_escape "$FEATURE_NUM")"
        fi
    fi
else
    echo "BRANCH_NAME: $BRANCH_NAME"
    echo "SPEC_FILE: $SPEC_FILE"
    echo "FEATURE_NUM: $FEATURE_NUM"
    if [ "$DRY_RUN" != true ]; then
        printf '# To persist in your shell: export SPECIFY_FEATURE=%q\n' "$BRANCH_NAME"
    fi
fi
