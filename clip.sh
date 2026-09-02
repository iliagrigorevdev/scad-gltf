#!/usr/bin/env bash

#
# clip-files.sh
#
# A script to concatenate content into the system clipboard.
# It can process piped input (stdin) and/or multiple files,
# prepending each content block with a Markdown-formatted header
# indicating its source (STDIN or filename).
#
# Usage (files):
#   ./clip-files.sh <file1.txt> <path/to/file2.log> ...
#
# Usage (pipe):
#   ls -l | ./clip-files.sh
#
# Usage (combined):
#   echo "Preamble" | ./clip-files.sh header.txt main_content.txt
#

# --- PRE-FLIGHT CHECKS ---

# 1. Check for a clipboard command and define a function
if command -v pbcopy &> /dev/null; then
  copy_to_clipboard() {
    pbcopy
  }
elif command -v xclip &> /dev/null; then
  copy_to_clipboard() {
    xclip -selection clipboard
  }
elif command -v termux-clipboard-set &> /dev/null; then
  copy_to_clipboard() {
    termux-clipboard-set
  }
else
  echo "Error: No clipboard command found. Please install pbcopy, xclip, or termux-clipboard-set." >&2
  exit 1
fi

# 2. Check if any input was provided at all (either arguments or a pipe).
#    [ -t 0 ] is true if file descriptor 0 (stdin) is connected to a terminal.
#    If no arguments are given AND stdin is from the terminal, there's no input.
if [ "$#" -eq 0 ] && [ -t 0 ]; then
  echo "Usage: $(basename "$0") <file1> <file2> ..." >&2
  echo "   or: <command> | $(basename "$0") [file...]" >&2
  echo "Copies content from files and/or stdin to the clipboard, prefixed by source." >&2
  exit 1
fi

# --- MAIN LOGIC ---

# Use a subshell `()` to group all output from the logic below.
# This entire grouped output is then piped as a single stream into our function.

(
  # First, check for and process piped input (stdin).
  # If stdin is NOT a terminal, it means data is being piped in.
  if ! [ -t 0 ]; then
    echo "### STDIN"
    echo "---"
    # 'cat' with no arguments reads from stdin until EOF
    echo '```'
    cat
    echo '```'
    # Add spacing if there are also file arguments to process
    if [ "$#" -gt 0 ]; then
      echo
    fi
  fi

  # Next, loop through every file argument passed to the script
  for file in "$@"; do
    # Check if the argument is a regular, readable file
    if [ -f "$file" ] && [ -r "$file" ]; then
      echo "### $file"
      echo "---"
      # Use 'cat' to print the file's content
      echo '```'
      cat "$file"
      echo '```'
      # Add a blank line for better spacing between subsequent files
      echo
    else
      # Print a warning to stderr (it won't go to the clipboard)
      echo "Warning: Skipping '$file'. It is not a regular, readable file." >&2
    fi
  done

) | copy_to_clipboard # Pipes the collected output to the clipboard

# Provide confirmation to the user
# Check if the pipeline was successful. $? holds the exit code of the last command.
if [ $? -eq 0 ]; then
  echo "Content from specified sources has been copied to the clipboard."
else
  echo "Error: Failed to copy content to the clipboard." >&2
fi
